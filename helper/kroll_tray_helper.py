"""PharmFlow AI - local desktop helper (kroll_tray_helper.py).

Bridges the PharmFlow web app to legacy Windows Pharmacy Management Systems by
replaying the verified prescription as keystrokes into the focused PMS window.

Run from source:      python kroll_tray_helper.py
Dry run (no typing):  python kroll_tray_helper.py --dry-run --verbose
Build a single .exe:  pyinstaller --noconfirm --onefile --noconsole ^
                        --name kroll_tray_helper kroll_tray_helper.py

Endpoints (bound to 127.0.0.1 only, never exposed to the LAN):
    GET  /health   -> {"status": "ok", "version": ..., "target_systems": [...]}
    POST /autofill -> {"status": "success", "message": ...}

Safety rules enforced here (all on by default):
  * Origin allow-list  - a random website you visit cannot make this helper type.
  * Optional shared token (x-helper-token) configured in config.ini [Helper].
  * Foreground-window check - keystrokes are only sent if the active window's
    title contains the expected PMS name (e.g. "Kroll"). Otherwise HTTP 409.
  * One autofill at a time (lock) so two requests can never interleave keys.
  * Input validation - missing patient / prescriber / bad DIN is rejected
    instead of being typed blindly into a clinical system.
  * Clipboard is restored after pasting.
  * No patient data is written to the log.

POST /autofill body:
    {
      "target_system": "KROLL",
      "data": {
        "patient_lookup":    "1234-567-890-ON",
        "prescriber_license": "CPSO-78901",
        "din_code":          "00628115",
        "quantity":          "30",
        "sig_text":          "1 CAP PO TID X 10D"
      }
    }
"""

from __future__ import annotations

import argparse
import configparser
import hmac
import logging
import re
import sys
import threading
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional

from flask import Flask, jsonify, request

try:  # imported lazily so the module can be inspected without a desktop session
    import pyautogui
    import pyperclip
except Exception:  # pragma: no cover - headless environments
    pyautogui = None
    pyperclip = None

VERSION = "1.3.0"
DEFAULT_PORT = 48120
DEFAULT_HOST = "127.0.0.1"
TARGET_SYSTEMS = ("KROLL", "PROPELRX", "WINRX")
CONFIG_PATH = Path(__file__).resolve().parent / "config.ini"

DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "https://pharmaflow-swart.vercel.app",
]

# Substring (case-insensitive) that must appear in the focused window's title.
DEFAULT_WINDOW_HINTS: Dict[str, str] = {
    "KROLL": "kroll",
    "PROPELRX": "propel",
    "WINRX": "winrx",
}

DIN_RE = re.compile(r"^\d{8}$")
MAX_FIELD_LEN = 300

app = Flask(__name__)
log = logging.getLogger("pharmflow.helper")


class Settings:
    """Runtime settings (config.ini [Helper] + CLI flags)."""

    allowed_origins: List[str] = list(DEFAULT_ORIGINS)
    token: str = ""
    dry_run: bool = False
    require_window_check: bool = True
    window_hints: Dict[str, str] = dict(DEFAULT_WINDOW_HINTS)
    step_delay: float = 0.4


SETTINGS = Settings()
_autofill_lock = threading.Lock()

if pyautogui is not None:
    pyautogui.FAILSAFE = True   # slam the mouse into a screen corner to abort
    pyautogui.PAUSE = 0.25      # safe typing delay between commands


class KeystrokeUnavailable(RuntimeError):
    """Raised when pyautogui/pyperclip are not usable on this machine."""


class ValidationError(ValueError):
    pass


class WrongWindow(RuntimeError):
    pass


def load_config(path: Path = CONFIG_PATH) -> None:
    if not path.exists():
        return
    cp = configparser.ConfigParser(interpolation=None)
    cp.read(path, encoding="utf-8")
    if not cp.has_section("Helper"):
        return
    origins = cp.get("Helper", "ALLOWED_ORIGINS", fallback="").strip()
    if origins:
        SETTINGS.allowed_origins = [o.strip().rstrip("/") for o in origins.split(",") if o.strip()]
    SETTINGS.token = cp.get("Helper", "TOKEN", fallback="").strip()
    SETTINGS.require_window_check = cp.getboolean("Helper", "REQUIRE_WINDOW_CHECK", fallback=True)
    SETTINGS.step_delay = cp.getfloat("Helper", "STEP_DELAY_SEC", fallback=0.4)
    for system in TARGET_SYSTEMS:
        hint = cp.get("Helper", f"WINDOW_{system}", fallback="").strip()
        if hint:
            SETTINGS.window_hints[system] = hint.lower()


# --------------------------------------------------------------------------- #
# Keystroke primitives
# --------------------------------------------------------------------------- #
def _require_backend() -> None:
    if pyautogui is None or pyperclip is None:
        raise KeystrokeUnavailable(
            "pyautogui / pyperclip are unavailable. Install them with "
            "`pip install -r requirements.txt` and run on an interactive "
            "Windows desktop session."
        )


def foreground_window_title() -> str:
    """Title of the currently focused window (Windows only, no extra packages)."""
    if sys.platform != "win32":
        return ""
    import ctypes

    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    length = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    return buf.value


def _check_window(target: str) -> None:
    if not SETTINGS.require_window_check or SETTINGS.dry_run:
        return
    hint = SETTINGS.window_hints.get(target, "")
    title = foreground_window_title()
    if not title or hint not in title.lower():
        raise WrongWindow(
            f"The active window is not {target.title()} (expected the title to contain "
            f"'{hint}'). Click into the pharmacy system and try again."
        )


class Typist:
    """Sends keys, or just logs them in --dry-run mode."""

    def press(self, key: str) -> None:
        log.debug("press %s", key)
        if not SETTINGS.dry_run:
            pyautogui.press(key)

    def hotkey(self, *keys: str) -> None:
        log.debug("hotkey %s", "+".join(keys))
        if not SETTINGS.dry_run:
            pyautogui.hotkey(*keys)

    def paste(self, text: str) -> None:
        """Clipboard-paste instead of typewrite: faster and handles unicode."""
        log.debug("paste <%d chars>", len(text))
        if SETTINGS.dry_run:
            return
        previous: Optional[str]
        try:
            previous = pyperclip.paste()
        except Exception:
            previous = None
        pyperclip.copy(text)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.15)  # let the target app read the clipboard before we restore it
        if previous is not None:
            pyperclip.copy(previous)

    def type_text(self, text: str) -> None:
        log.debug("type <%d chars>", len(text))
        if not SETTINGS.dry_run:
            pyautogui.typewrite(text)

    def wait(self) -> None:
        if not SETTINGS.dry_run:
            time.sleep(SETTINGS.step_delay)


# --------------------------------------------------------------------------- #
# Target system drivers
# --------------------------------------------------------------------------- #
def _autofill_kroll(t: Typist, data: dict) -> str:
    """TELUS Kroll: F3 patient, F7 prescriber, F5 drug, then sig + quantity.

    NOTE: these hotkeys are the documented defaults. Confirm them on the real
    Kroll screens with --dry-run first, and adjust here if your site differs.
    """
    t.press("f3")
    t.paste(data["patient_lookup"])
    t.press("enter")
    t.wait()

    t.press("f7")
    t.paste(data["prescriber_license"])
    t.press("enter")
    t.wait()

    if data.get("din_code"):
        t.press("f5")
        t.paste(data["din_code"])
        t.press("enter")
        t.wait()
    else:
        log.info("KROLL no DIN supplied (compound) - skipping product search")

    t.paste(data["sig_text"])
    t.press("tab")
    t.type_text(str(data["quantity"]))
    return "Autofill triggered into Kroll"


def _autofill_propelrx(t: Typist, data: dict) -> str:
    """McKesson Propel Rx: Ctrl+N new Rx, Ctrl+F patient, F2 prescriber, F6 drug."""
    t.hotkey("ctrl", "n")
    t.wait()

    t.hotkey("ctrl", "f")
    t.paste(data["patient_lookup"])
    t.press("enter")
    t.wait()

    t.press("f2")
    t.paste(data["prescriber_license"])
    t.press("enter")
    t.wait()

    if data.get("din_code"):
        t.press("f6")
        t.paste(data["din_code"])
        t.press("enter")
        t.wait()

    t.paste(data["sig_text"])
    t.press("tab")
    t.type_text(str(data["quantity"]))
    return "Autofill triggered into Propel Rx"


def _autofill_winrx(t: Typist, data: dict) -> str:
    """WinRx / Nexsys: client record -> doctor record -> drug code -> sig."""
    t.hotkey("alt", "c")
    t.paste(data["patient_lookup"])
    t.press("enter")
    t.wait()

    t.hotkey("alt", "d")
    t.paste(data["prescriber_license"])
    t.press("enter")
    t.wait()

    if data.get("din_code"):
        t.hotkey("alt", "p")
        t.paste(data["din_code"])
        t.press("enter")
        t.wait()

    t.paste(data["sig_text"])
    t.press("tab")
    t.type_text(str(data["quantity"]))
    return "Autofill triggered into WinRx"


DRIVERS: Dict[str, Callable[[Typist, dict], str]] = {
    "KROLL": _autofill_kroll,
    "PROPELRX": _autofill_propelrx,
    "WINRX": _autofill_winrx,
}


def validate_data(data: dict) -> Dict[str, str]:
    """Normalise to strings, enforce required fields, reject control characters."""
    clean: Dict[str, str] = {}
    for key in ("patient_lookup", "prescriber_license", "din_code", "quantity", "sig_text"):
        value = data.get(key, "")
        value = "" if value is None else str(value).strip()
        if len(value) > MAX_FIELD_LEN:
            raise ValidationError(f"{key} is too long")
        if any(ord(ch) < 32 for ch in value):
            raise ValidationError(f"{key} contains control characters")
        clean[key] = value

    for key in ("patient_lookup", "prescriber_license", "quantity", "sig_text"):
        if not clean[key]:
            raise ValidationError(f"Missing required field: {key}")
    if clean["din_code"] and not DIN_RE.match(clean["din_code"]):
        raise ValidationError("din_code must be exactly 8 digits")
    if not re.match(r"^\d+(\.\d+)?$", clean["quantity"]):
        raise ValidationError("quantity must be a number")
    return clean


# --------------------------------------------------------------------------- #
# Request guards + CORS (explicit allow-list; no wildcard)
# --------------------------------------------------------------------------- #
def _origin_allowed(origin: Optional[str]) -> bool:
    return origin is not None and origin.rstrip("/") in SETTINGS.allowed_origins


@app.before_request
def guard():
    origin = request.headers.get("Origin")

    # Browser requests always carry Origin: reject anything not on the allow-list.
    if origin is not None and not _origin_allowed(origin):
        log.warning("blocked request from origin %s", origin)
        return jsonify({"status": "error", "message": "Origin not allowed"}), 403

    if request.method == "OPTIONS":
        return None  # preflight answered in after_request

    if request.path == "/autofill" and SETTINGS.token:
        supplied = request.headers.get("x-helper-token", "")
        if not hmac.compare_digest(supplied, SETTINGS.token):
            return jsonify({"status": "error", "message": "Invalid or missing helper token"}), 401
    return None


@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin")
    if _origin_allowed(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, x-helper-token"
        # Chrome requires this when a public HTTPS site (Vercel) calls localhost.
        if request.headers.get("Access-Control-Request-Private-Network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        response.headers["Access-Control-Max-Age"] = "600"
    return response


# --------------------------------------------------------------------------- #
# HTTP API
# --------------------------------------------------------------------------- #
@app.route("/health", methods=["GET", "OPTIONS"])
def health():
    return jsonify(
        {
            "status": "ok",
            "version": VERSION,
            "target_systems": list(TARGET_SYSTEMS),
            "keystrokes_available": pyautogui is not None,
            "dry_run": SETTINGS.dry_run,
            "token_required": bool(SETTINGS.token),
        }
    )


@app.get("/")
def index():
    return health()


@app.route("/autofill", methods=["POST", "OPTIONS"])
def autofill():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True)  # requires Content-Type: application/json
    if not isinstance(payload, dict):
        return jsonify({"status": "error", "message": "Body must be JSON"}), 400

    target = str(payload.get("target_system", "KROLL")).upper()
    driver = DRIVERS.get(target)
    if driver is None:
        return jsonify({"status": "error", "message": f"Unknown target system: {target}"}), 400

    raw = payload.get("data")
    if not isinstance(raw, dict) or not raw:
        return jsonify({"status": "error", "message": "Missing 'data' object"}), 400

    try:
        data = validate_data(raw)
    except ValidationError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    if not _autofill_lock.acquire(blocking=False):
        return jsonify({"status": "error", "message": "Another autofill is already running"}), 429

    try:
        if not SETTINGS.dry_run:
            _require_backend()
        _check_window(target)
        log.info("%s autofill start (din=%s, qty=%s)", target, data["din_code"] or "none", data["quantity"])
        message = driver(Typist(), data)
    except KeystrokeUnavailable as exc:
        log.error("keystroke backend unavailable: %s", exc)
        return jsonify({"status": "error", "message": str(exc)}), 503
    except WrongWindow as exc:
        log.warning("refused: %s", exc)
        return jsonify({"status": "error", "message": str(exc)}), 409
    except Exception as exc:  # pragma: no cover - defensive
        if pyautogui is not None and isinstance(exc, pyautogui.FailSafeException):
            log.warning("failsafe triggered - user moved the mouse to a corner")
            return jsonify({"status": "error", "message": "Failsafe triggered; autofill aborted."}), 409
        log.exception("autofill failed")
        return jsonify({"status": "error", "message": f"Autofill failed: {exc}"}), 500
    finally:
        _autofill_lock.release()

    if SETTINGS.dry_run:
        message = f"[DRY RUN] {message} (no keys were sent)"
    return jsonify({"status": "success", "message": message, "target_system": target})


# --------------------------------------------------------------------------- #
# Server + optional system-tray shell
# --------------------------------------------------------------------------- #
def _run_server(host: str, port: int) -> None:
    try:
        from waitress import serve

        serve(app, host=host, port=port, threads=4)
    except ImportError:  # waitress optional - Flask dev server is fine on loopback
        app.run(host=host, port=port, threaded=True)


def _run_with_tray(host: str, port: int) -> bool:
    """Start a tray icon that owns the server. Returns False if unavailable."""
    try:
        import pystray
        from PIL import Image, ImageDraw
    except Exception:
        return False

    image = Image.new("RGB", (64, 64), "#4f46e5")
    draw = ImageDraw.Draw(image)
    draw.rectangle((16, 22, 48, 34), fill="white")
    draw.rectangle((28, 12, 36, 52), fill="white")

    server = threading.Thread(target=_run_server, args=(host, port), daemon=True)
    server.start()

    def on_quit(icon, _item):
        icon.stop()

    icon = pystray.Icon(
        "pharmflow",
        image,
        f"PharmFlow helper :{port}",
        menu=pystray.Menu(pystray.MenuItem("Quit", on_quit)),
    )
    icon.run()
    return True


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="PharmFlow local desktop helper")
    parser.add_argument("--host", default=DEFAULT_HOST, help="bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="listen port")
    parser.add_argument("--no-tray", action="store_true", help="run headless without a tray icon")
    parser.add_argument("--dry-run", action="store_true", help="validate + log only; send NO keystrokes")
    parser.add_argument("--verbose", action="store_true", help="debug logging")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    load_config()
    SETTINGS.dry_run = args.dry_run

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        log.error("Refusing to bind to %s - this helper must stay on loopback.", args.host)
        return 2

    log.info("PharmFlow helper %s on http://%s:%s%s", VERSION, args.host, args.port,
             " [DRY RUN]" if SETTINGS.dry_run else "")
    log.info("Allowed origins: %s | token required: %s | window check: %s",
             ", ".join(SETTINGS.allowed_origins), bool(SETTINGS.token), SETTINGS.require_window_check)
    if pyautogui is None:
        log.warning("pyautogui not available - /autofill will return 503 (use --dry-run to test)")

    if not args.no_tray and _run_with_tray(args.host, args.port):
        return 0

    _run_server(args.host, args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
