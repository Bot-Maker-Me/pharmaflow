"""
================================================================================
  PharmFlow — WORKSTATION HELPER  (run this on each pharmacist PC)
================================================================================

ONE FILE. Install this on every PC where staff will click "Push to Kroll"
in the PharmFlow web app.

What it does:
  - Listens only on 127.0.0.1:48120 (never exposed to the network)
  - When the web app sends a verified prescription, it types the fields into
    the focused Kroll window using keystrokes (F3 patient, F7 prescriber, etc.)
  - Refuses to type if the active window is not Kroll (safety)

Quick start
-----------
  1. pip install -r requirements.txt
  2. Copy the [Helper] section of config.ini.example into a config.ini next to this file
  3. python workstation_helper.py --dry-run --verbose   # safe test, no keys sent
  4. Open the PharmFlow web app → Settings → check Helper status is green
  5. python workstation_helper.py                       # real mode

Safety rules (all on by default)
  * Origin allow-list  — random websites cannot make this helper type
  * Optional shared token (x-helper-token)
  * Foreground-window check — only types when Kroll is focused
  * One autofill at a time
  * Fail-safe: slam mouse into a screen corner to abort typing
  * No patient data is written to the log
================================================================================
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

try:
    import pyautogui
    import pyperclip
except Exception:
    pyautogui = None
    pyperclip = None

VERSION = "1.4.0"
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
    allowed_origins: List[str] = list(DEFAULT_ORIGINS)
    token: str = ""
    dry_run: bool = False
    require_window_check: bool = True
    window_hints: Dict[str, str] = dict(DEFAULT_WINDOW_HINTS)
    step_delay: float = 0.4


SETTINGS = Settings()
_autofill_lock = threading.Lock()

if pyautogui is not None:
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.25


class KeystrokeUnavailable(RuntimeError):
    pass


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


def _require_backend() -> None:
    if pyautogui is None or pyperclip is None:
        raise KeystrokeUnavailable(
            "pyautogui / pyperclip are unavailable. Install them with "
            "`pip install -r requirements.txt` and run on an interactive Windows desktop."
        )


def foreground_window_title() -> str:
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
    def press(self, key: str) -> None:
        log.debug("press %s", key)
        if not SETTINGS.dry_run:
            pyautogui.press(key)

    def hotkey(self, *keys: str) -> None:
        log.debug("hotkey %s", "+".join(keys))
        if not SETTINGS.dry_run:
            pyautogui.hotkey(*keys)

    def paste(self, text: str) -> None:
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
        time.sleep(0.15)
        if previous is not None:
            pyperclip.copy(previous)

    def type_text(self, text: str) -> None:
        log.debug("type <%d chars>", len(text))
        if not SETTINGS.dry_run:
            pyautogui.typewrite(text)

    def wait(self) -> None:
        if not SETTINGS.dry_run:
            time.sleep(SETTINGS.step_delay)


def _autofill_kroll(t: Typist, data: dict) -> str:
    """TELUS Kroll: F3 patient, F7 prescriber, F5 drug, then sig + quantity."""
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


def _origin_allowed(origin: Optional[str]) -> bool:
    return origin is not None and origin.rstrip("/") in SETTINGS.allowed_origins


@app.before_request
def guard():
    origin = request.headers.get("Origin")
    if origin is not None and not _origin_allowed(origin):
        log.warning("blocked request from origin %s", origin)
        return jsonify({"status": "error", "message": "Origin not allowed"}), 403
    if request.method == "OPTIONS":
        return None
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
        if request.headers.get("Access-Control-Request-Private-Network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        response.headers["Access-Control-Max-Age"] = "600"
    return response


@app.route("/health", methods=["GET", "OPTIONS"])
def health():
    return jsonify({
        "status": "ok",
        "version": VERSION,
        "target_systems": list(TARGET_SYSTEMS),
        "keystrokes_available": pyautogui is not None,
        "dry_run": SETTINGS.dry_run,
        "token_required": bool(SETTINGS.token),
    })


@app.get("/")
def index():
    return health()


@app.route("/autofill", methods=["POST", "OPTIONS"])
def autofill():
    if request.method == "OPTIONS":
        return ("", 204)
    payload = request.get_json(silent=True)
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
        return jsonify({"status": "error", "message": str(exc)}), 503
    except WrongWindow as exc:
        return jsonify({"status": "error", "message": str(exc)}), 409
    except Exception as exc:
        if pyautogui is not None and isinstance(exc, pyautogui.FailSafeException):
            return jsonify({"status": "error", "message": "Failsafe triggered; autofill aborted."}), 409
        log.exception("autofill failed")
        return jsonify({"status": "error", "message": f"Autofill failed: {exc}"}), 500
    finally:
        _autofill_lock.release()
    if SETTINGS.dry_run:
        message = f"[DRY RUN] {message} (no keys were sent)"
    return jsonify({"status": "success", "message": message, "target_system": target})


def _run_server(host: str, port: int) -> None:
    try:
        from waitress import serve
        serve(app, host=host, port=port, threads=4)
    except ImportError:
        app.run(host=host, port=port, threaded=True)


def _run_with_tray(host: str, port: int) -> bool:
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
    icon = pystray.Icon("pharmflow", image, f"PharmFlow helper :{port}",
                        menu=pystray.Menu(pystray.MenuItem("Quit", on_quit)))
    icon.run()
    return True


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="PharmFlow workstation helper")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-tray", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    load_config()
    SETTINGS.dry_run = args.dry_run
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        log.error("Refusing to bind to %s - this helper must stay on loopback.", args.host)
        return 2
    log.info("PharmFlow workstation helper %s on http://%s:%s%s", VERSION, args.host, args.port,
             " [DRY RUN]" if SETTINGS.dry_run else "")
    if not args.no_tray and _run_with_tray(args.host, args.port):
        return 0
    _run_server(args.host, args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
