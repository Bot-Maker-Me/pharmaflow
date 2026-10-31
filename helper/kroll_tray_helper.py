"""PharmFlow AI - local desktop helper (kroll_tray_helper.py).

Bridges the PharmFlow web app to legacy Windows Pharmacy Management Systems by
replaying the verified prescription as keystrokes into the currently focused
PMS window.

Run from source:      python kroll_tray_helper.py
Build a single .exe:  pyinstaller --noconfirm --onefile --noconsole ^
                        --name kroll_tray_helper kroll_tray_helper.py

Endpoints (bound to 127.0.0.1 only, never exposed to the LAN):
    GET  /health   -> {"status": "ok", "version": ..., "target_systems": [...]}
    POST /autofill -> {"status": "success", "message": ...}

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
import logging
import sys
import threading
import time

from flask import Flask, jsonify, request
from flask_cors import CORS

try:  # imported lazily so the module can be inspected without a desktop session
    import pyautogui
    import pyperclip
except Exception:  # pragma: no cover - headless environments
    pyautogui = None
    pyperclip = None

VERSION = "1.2.0"
DEFAULT_PORT = 48120
DEFAULT_HOST = "127.0.0.1"
TARGET_SYSTEMS = ("KROLL", "PROPELRX", "WINRX")

app = Flask(__name__)
CORS(app)

log = logging.getLogger("pharmflow.helper")

if pyautogui is not None:
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.25  # Safe typing delay between commands


class KeystrokeUnavailable(RuntimeError):
    """Raised when pyautogui/pyperclip are not usable on this machine."""


def _require_backend() -> None:
    if pyautogui is None or pyperclip is None:
        raise KeystrokeUnavailable(
            "pyautogui / pyperclip are unavailable. Install them with "
            "`pip install -r requirements.txt` and run on an interactive "
            "Windows desktop session."
        )


def _paste(text: str) -> None:
    """Clipboard-paste instead of typewrite: faster and handles unicode."""
    pyperclip.copy(text)
    pyautogui.hotkey("ctrl", "v")


def _field(label: str, value: str) -> str:
    return f"{label}={value or '-'}"


# --------------------------------------------------------------------------- #
# Target system drivers
# --------------------------------------------------------------------------- #
def _autofill_kroll(data: dict) -> str:
    """TELUS Kroll: F3 patient, F7 prescriber, F5 drug, then sig + quantity."""
    log.info("KROLL %s", _field("patient", data.get("patient_lookup", "")))

    pyautogui.press("f3")
    _paste(data.get("patient_lookup", ""))
    pyautogui.press("enter")
    time.sleep(0.4)

    pyautogui.press("f7")
    _paste(data.get("prescriber_license", ""))
    pyautogui.press("enter")
    time.sleep(0.4)

    din_code = data.get("din_code", "")
    if din_code:
        pyautogui.press("f5")
        _paste(din_code)
        pyautogui.press("enter")
        time.sleep(0.4)
    else:
        log.info("KROLL no DIN supplied (compound) - skipping product search")

    _paste(data.get("sig_text", ""))
    pyautogui.press("tab")
    pyautogui.typewrite(str(data.get("quantity", "")))
    return "Autofill triggered into Kroll"


def _autofill_propelrx(data: dict) -> str:
    """McKesson Propel Rx: Ctrl+N new Rx, Ctrl+F patient, F6 drug search."""
    log.info("PROPELRX %s", _field("patient", data.get("patient_lookup", "")))

    pyautogui.hotkey("ctrl", "n")
    time.sleep(0.4)

    pyautogui.hotkey("ctrl", "f")
    _paste(data.get("patient_lookup", ""))
    pyautogui.press("enter")
    time.sleep(0.4)

    pyautogui.press("f2")
    _paste(data.get("prescriber_license", ""))
    pyautogui.press("enter")
    time.sleep(0.4)

    din_code = data.get("din_code", "")
    if din_code:
        pyautogui.press("f6")
        _paste(din_code)
        pyautogui.press("enter")
        time.sleep(0.4)

    _paste(data.get("sig_text", ""))
    pyautogui.press("tab")
    pyautogui.typewrite(str(data.get("quantity", "")))
    return "Autofill triggered into Propel Rx"


def _autofill_winrx(data: dict) -> str:
    """WinRx / Nexsys: client record -> doctor record -> drug code -> sig."""
    log.info("WINRX %s", _field("patient", data.get("patient_lookup", "")))

    pyautogui.hotkey("alt", "c")
    _paste(data.get("patient_lookup", ""))
    pyautogui.press("enter")
    time.sleep(0.4)

    pyautogui.hotkey("alt", "d")
    _paste(data.get("prescriber_license", ""))
    pyautogui.press("enter")
    time.sleep(0.4)

    din_code = data.get("din_code", "")
    if din_code:
        pyautogui.hotkey("alt", "p")
        _paste(din_code)
        pyautogui.press("enter")
        time.sleep(0.4)

    _paste(data.get("sig_text", ""))
    pyautogui.press("tab")
    pyautogui.typewrite(str(data.get("quantity", "")))
    return "Autofill triggered into WinRx"


DRIVERS = {
    "KROLL": _autofill_kroll,
    "PROPELRX": _autofill_propelrx,
    "WINRX": _autofill_winrx,
}


# --------------------------------------------------------------------------- #
# HTTP API
# --------------------------------------------------------------------------- #
@app.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "version": VERSION,
            "target_systems": list(TARGET_SYSTEMS),
            "keystrokes_available": pyautogui is not None,
        }
    )


@app.get("/")
def index():
    return health()


@app.post("/autofill")
def autofill():
    payload = request.get_json(silent=True) or {}
    target = str(payload.get("target_system", "KROLL")).upper()
    data = payload.get("data") or {}

    driver = DRIVERS.get(target)
    if driver is None:
        return (
            jsonify({"status": "error", "message": f"Unknown target system: {target}"}),
            400,
        )

    if not isinstance(data, dict) or not data:
        return jsonify({"status": "error", "message": "Missing 'data' object"}), 400

    try:
        _require_backend()
        message = driver(data)
    except KeystrokeUnavailable as exc:
        log.error("keystroke backend unavailable: %s", exc)
        return jsonify({"status": "error", "message": str(exc)}), 503
    except pyautogui.FailSafeException:
        log.warning("failsafe triggered - user grabbed the mouse")
        return (
            jsonify({"status": "error", "message": "Failsafe triggered; autofill aborted."}),
            409,
        )
    except Exception as exc:  # pragma: no cover - defensive
        log.exception("autofill failed")
        return jsonify({"status": "error", "message": f"Autofill failed: {exc}"}), 500

    return jsonify({"status": "success", "message": message, "target_system": target})


# --------------------------------------------------------------------------- #
# Optional system-tray shell
# --------------------------------------------------------------------------- #
def _run_server(host: str, port: int) -> None:
    app.run(host=host, port=port, threaded=True)


def _run_with_tray(host: str, port: int) -> bool:
    """Start a tray icon that owns the Flask server. Returns False if unavailable."""
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PharmFlow local desktop helper")
    parser.add_argument("--host", default=DEFAULT_HOST, help="bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="listen port")
    parser.add_argument("--no-tray", action="store_true", help="run headless without a tray icon")
    parser.add_argument("--verbose", action="store_true", help="debug logging")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    log.info("PharmFlow helper %s listening on http://%s:%s", VERSION, args.host, args.port)
    if pyautogui is None:
        log.warning("pyautogui not available - /autofill will return 503")

    if not args.no_tray and _run_with_tray(args.host, args.port):
        return 0

    _run_server(args.host, args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
