# PharmFlow local desktop helper

`kroll_tray_helper.py` is the on-premise bridge between the PharmFlow web app and
the legacy Pharmacy Management System running on the pharmacy workstation. It
exposes a tiny local HTTP API and replays the verified prescription as
keystrokes into the focused PMS window.

It binds to `127.0.0.1` on port `48120` — it is never exposed to the LAN, and it
never talks to the internet.

## Install & run from source

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python kroll_tray_helper.py --verbose
```

The helper runs with a system-tray icon (blue cross) when `pystray` + `Pillow`
are installed. Use `--no-tray` for a headless console session.

The workstation must be an interactive desktop session: keystrokes are injected
into whatever window has focus.

## Build a single executable

```powershell
pip install pyinstaller
pyinstaller --noconfirm --onefile --noconsole --name kroll_tray_helper kroll_tray_helper.py
```

The resulting `dist\kroll_tray_helper.exe` can be dropped into
`%LOCALAPPDATA%\PharmFlow\` and started from a shortcut or a Run-key entry so it
is always listening when pharmacy staff log in.

> Build the `.exe` on the oldest Windows version you need to support so the
> bundle resolves against a compatible `pyautogui`/`Pillow` toolchain.

## Endpoints

| Method | Path        | Purpose                                     |
| ------ | ----------- | ------------------------------------------- |
| `GET`  | `/health`   | Liveness probe used by the web app header   |
| `GET`  | `/`         | Alias of `/health`                          |
| `POST` | `/autofill` | Replay one prescription line into the PMS   |

### `GET /health`

```json
{
  "status": "ok",
  "version": "1.2.0",
  "target_systems": ["KROLL", "PROPELRX", "WINRX"],
  "keystrokes_available": true
}
```

### `POST /autofill`

```json
{
  "target_system": "KROLL",
  "data": {
    "patient_lookup": "1234-567-890-ON",
    "prescriber_license": "CPSO-78901",
    "din_code": "00628115",
    "quantity": "30",
    "sig_text": "1 CAP PO TID X 10D"
  }
}
```

Responses:

- `200 {"status": "success", "message": "Autofill triggered into Kroll", "target_system": "KROLL"}`
- `400` missing/unknown target system or missing `data`
- `409` the pyautogui failsafe fired (the user grabbed the mouse)
- `500` unexpected driver failure
- `503` `pyautogui` / `pyperclip` are not installed or not on a desktop session

Notes:

- `din_code` may be an empty string for extemporaneous compounds — the helper
  then skips the product-search keystroke.
- `quantity` is sent as a string so it can be typed literally.
- One request is issued per medication, so a page with three prescriptions
  produces three calls.

## Key mappings

| Target system      | Patient        | Prescriber | Drug search | Sig / qty        |
| ------------------ | -------------- | ---------- | ----------- | ---------------- |
| TELUS Kroll        | `F3`           | `F7`       | `F5`        | paste, `Tab`     |
| McKesson Propel Rx | `Ctrl+F`       | `F2`       | `F6`        | paste, `Tab`     |
| WinRx / Nexsys     | `Alt+C`        | `Alt+D`    | `Alt+P`     | paste, `Tab`     |

Key sequences vary between PMS builds and site customisations. Adjust the
`_autofill_*` drivers at the top of `kroll_tray_helper.py`; the web app does not
need to change.

## Safety

- `pyautogui.FAILSAFE` is enabled: slam the pointer into a screen corner to
  abort an in-flight autofill.
- `pyautogui.PAUSE = 0.25` keeps the injected keystrokes slower than the PMS
  event loop so fields are never skipped.
- The helper writes no patient data to disk and logs only field names, never
  field values.
