# PharmFlow — setup & run guide

## What runs where

| Where | What | Why |
|-------|------|-----|
| **Client server PC** (the machine hosting Kroll's SQL Server) | `helper/flow.py` | Read-only poller of `PendingNewRx`; sends rows to the cloud |
| **Work PC** (the workstation where the pharmacist uses Kroll) | `helper/kroll_tray_helper.py` + a browser with the PharmFlow web app | Types a verified Rx into Kroll |
| **Cloud** | Vercel (web app + `/api/*`) and Supabase (table `agent_sync_queue`) | Hosting + storage |

Before anything touches real patient data, get **written permission from the pharmacy owner / privacy officer**
for (a) read access to the Kroll database and (b) copying patient data to a cloud service. Patient names, DOBs
and addresses are PHI (PIPEDA / provincial health-privacy law). Use the Supabase **Canada (Central)** region.

---

## Part 1 — Cloud (once, from your own laptop)

1. **Supabase**: create a project (region *Canada Central*). In the SQL editor run
   `supabase/migrations/20261101_agent_sync_queue.sql`.
   If you already ran the older version of that file, run `20261102_security_and_dedupe.sql` instead —
   it removes a policy that let every signed-in user read all patient rows.
2. **Vercel**: import the GitHub repo. Add these environment variables (see `.env.example`):
   `AGENT_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `EXTRACT_ACCESS_TOKEN`.
   Generate secrets with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Deploy. Then check the API is protected and alive (replace the URL and key):
   ```
   curl -i https://YOUR-APP.vercel.app/api/sync-queue                      # expect 401
   curl -s -H "x-api-key: YOUR_AGENT_API_KEY" https://YOUR-APP.vercel.app/api/sync-queue   # expect {"ok":true,"count":0,...}
   ```

## Part 2 — Client server PC (Kroll SQL Server) — `flow.py`

Requirements: Windows, Python 3.10+ (tick *Add to PATH*), **ODBC Driver 17 for SQL Server**.

1. Ask the pharmacy's IT/Kroll support to create a **read-only** SQL login (run once as sysadmin):
   ```sql
   CREATE LOGIN rx WITH PASSWORD = 'StrongPasswordHere!', CHECK_POLICY = ON;
   USE Pharmacy;                       -- use the real database name
   CREATE USER rx FOR LOGIN rx;
   GRANT SELECT ON SCHEMA::dbo TO rx;  -- read only: no INSERT/UPDATE/DELETE
   ```
   If you were given your own read account, use that instead of `rx`.
2. Copy the `helper` folder to e.g. `C:\PharmFlow\helper`, then in PowerShell:
   ```powershell
   cd C:\PharmFlow\helper
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   copy config.ini.example config.ini
   notepad config.ini
   ```
   Set `[Database]` SERVER / DATABASE / UID / PWD. Keep `MODE = SHADOW` for now.
3. **Verify the Kroll table/column names** (they are educated guesses until checked):
   ```powershell
   python flow.py --discover
   ```
   Compare the printed tables with the `[Schema]` defaults in `config.ini.example`. For every name that
   differs, uncomment that line in `[Schema]` and fix it. Then:
   ```powershell
   python flow.py --test        # expect: TEST OK: connected, query ran, N pending row(s) visible
   ```
4. **SHADOW run** (reads Kroll, logs IDs only, sends nothing):
   ```powershell
   python flow.py
   ```
   Let it run through a few real prescriptions. Check `logs\pharmflow.log` shows `[SHADOW] PendingRxId=...`.
5. **Go LIVE**: stop it (Ctrl+C), set in `config.ini`:
   `MODE = LIVE`, `[Cloud] API_URL = https://YOUR-APP.vercel.app/api/sync-queue`, `API_KEY = <AGENT_API_KEY>`.
   Run `python flow.py`; you should see `Synced PendingRxId=...`. Confirm with the `curl` GET above, or the
   Supabase table editor.
6. **Run it at boot** (Task Scheduler): *Create Task* → run whether user is logged on or not →
   Trigger *At startup* → Action: program `C:\PharmFlow\helper\.venv\Scripts\python.exe`,
   arguments `flow.py`, *Start in* `C:\PharmFlow\helper` → Settings: restart on failure every 1 minute.

## Part 3 — Work PC (keystrokes into Kroll) — `kroll_tray_helper.py`

1. Same Python + venv + `pip install -r requirements.txt` steps in a folder on the work PC
   (`ODBC` is not needed here). Create `config.ini` containing only the `[Helper]` section from the example:
   - `ALLOWED_ORIGINS` — your Vercel URL (and `http://localhost:5173` if you run it locally).
   - `TOKEN` — any long random string (and paste the same one in the web app: *Settings → Helper token*).
2. **Dry run first** — validates everything and logs the plan but sends **no keys**:
   ```powershell
   python kroll_tray_helper.py --dry-run --verbose
   ```
   Open the web app → *Settings → Re-check /health* should show connected. Push a sample script; the helper
   log shows the steps.
3. **Calibrate the hotkeys on the real Kroll screens.** The defaults (`F3` patient, `F7` prescriber, `F5`
   drug, then sig, `Tab`, quantity) are the documented ones but are **not verified against your Kroll
   version**. Do a real run on a **test patient** with Kroll's New Rx screen focused, watch it type, and edit
   `_autofill_kroll()` in `kroll_tray_helper.py` if a key differs. Keep your hand near the mouse:
   moving the pointer to a screen corner aborts typing (PyAutoGUI fail-safe).
4. Real run: `python kroll_tray_helper.py`. The helper refuses with *"active window is not Kroll"* unless
   the Kroll window is focused when you press **Push** (if your window title does not contain "Kroll", set
   `WINDOW_KROLL = <part of the title>` in `[Helper]`).
5. Autostart: put a shortcut to `.venv\Scripts\pythonw.exe kroll_tray_helper.py` in `shell:startup`.
   Optional single exe: `pyinstaller --noconfirm --onefile --noconsole --name kroll_tray_helper kroll_tray_helper.py`.
6. In the web app (*Settings*): PMS = Kroll, Helper URL `http://localhost:48120`, Helper token, and for AI
   extraction: *Extraction mode = Live*, *API access token = EXTRACT_ACCESS_TOKEN*, API base URL blank.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Login failed for user` / `connect failed` | Wrong UID/PWD, or SQL Server doesn't allow SQL logins / TCP. Try `SERVER = HOSTNAME\SQLEXPRESS`. |
| `Invalid object name 'dbo.PendingNewRx'` or `Invalid column name` | Table/column differs — run `--discover`, fix `[Schema]`. |
| `Data source name not found` | Install ODBC Driver 17 (or set `DRIVER =` to the installed one: `odbcad32` → Drivers). |
| Web app says helper offline from the Vercel site | Check `ALLOWED_ORIGINS` has the exact site origin; use a current Chrome/Edge; helper must be running. |
| `HTTP 401` from `flow.py` | `API_KEY` ≠ Vercel `AGENT_API_KEY`. |
| *Wrong window* (409) | Click into Kroll first, or fix `WINDOW_KROLL`. |
| Live extraction falls back to demo | Settings → API access token missing/wrong, or `ANTHROPIC_API_KEY` not set on Vercel. |

## Known limits

- The cloud queue (`agent_sync_queue`) is written but **no screen in the web app reads it yet**.
- There is no billing / claim-reprocessing logic in this repo; it covers intake and Rx data entry only.
- Kroll table names and hotkeys are unverified against a real installation (steps 2.3 and 3.3).
