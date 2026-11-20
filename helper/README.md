# PharmFlow local helpers — simplified layout

You only need to run **two** programs.

| File you run | Where | What it does |
|--------------|-------|--------------|
| **`server_agent.py`** | **One** pharmacy server PC (can reach Kroll SQL) | Polls for new faxes → AI OCR → cloud queue |
| **`workstation_helper.py`** | **Every** pharmacist PC | Types verified Rx into the focused Kroll window |

Internal support files (do **not** run these yourself):
- `flow_body.py` — full poller logic (loaded by server_agent.py)
- `kroll_images.py` — fax image reader (used by the poller)

The **Vercel web app** is the shared UI. Open the same URL on any PC.
Staff review the queue there and click **Push**. The workstation helper only
needs to be running on the PC they are sitting at.

---

## 1. Server PC (run once)

```powershell
cd C:\PharmFlow\helper
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy config.ini.example config.ini
notepad config.ini          # fill [Database] and [Cloud]
```

```powershell
python server_agent.py --test          # must print TEST OK
python server_agent.py --discover      # check real column names
python server_agent.py                 # start (leave MODE=SHADOW first)
```

To keep it running after reboot:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_service.ps1
```

## 2. Each workstation

```powershell
cd C:\PharmFlow\helper
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
# create config.ini with only the [Helper] section (see config.ini.example)
python workstation_helper.py --dry-run --verbose   # safe test
python workstation_helper.py                       # real mode
```

In the web app → **Settings**:
- Helper URL = `http://localhost:48120`
- Helper token = same value as `TOKEN` in config.ini
- PMS = Kroll

## 3. Vercel web app (already deployed)

**Yes — open the same Vercel URL on every PC.** It is the central dashboard.
No install needed for the UI itself. Only the workstation helper is local.

---

## Safety rules

- `server_agent.py` only runs `SELECT` queries. It never writes to Kroll.
- Start in `MODE = SHADOW` for a week. Compare with `--shadow-report` before going `LIVE`.
- `workstation_helper.py` only types when the Kroll window is focused.
- Get written permission from the pharmacy owner before connecting to the live database.
