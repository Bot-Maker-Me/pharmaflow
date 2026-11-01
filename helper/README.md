# PharmFlow local desktop helpers

Two processes run on the pharmacy Windows workstation:

| Script | Role |
|--------|------|
| `kroll_tray_helper.py` | Keystroke bridge — receives verified scripts from the web app and types into Kroll / Propel / WinRx |
| `flow.py` | Read-only SQL agent — polls `PendingNewRx`, enriches with patient/doctor, syncs to cloud |

---

## flow.py — Kroll poller + cloud sync

### Install

```powershell
cd helper
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Also install **ODBC Driver 17 for SQL Server** on the machine if it is not already present.

### Config

```powershell
copy config.ini.example config.ini
notepad config.ini
```

Set:

- `Database.UID` / `PWD` — dedicated **read-only** SQL login (recommended: `rx`)
- `Cloud.API_URL` — e.g. `https://pharmaflow-swart.vercel.app/api/sync-queue`
- `Cloud.API_KEY` — same value as Vercel env `AGENT_API_KEY`
- `Agent.MODE` — `SHADOW` (log only) or `LIVE` (push to cloud)

### Create the read-only SQL user (run once as sysadmin on Kroll)

```sql
CREATE LOGIN rx WITH PASSWORD = 'StrongPasswordHere!', CHECK_POLICY = ON;
USE Pharmacy;
CREATE USER rx FOR LOGIN rx;
GRANT SELECT ON SCHEMA::dbo TO rx;
```

### Run

```powershell
python flow.py
```

Logs: `helper/logs/pharmflow.log` (daily rotation).  
Offline spool / dedupe: `helper/shadow_queue.db`.

### Cloud endpoint

`POST /api/sync-queue` with header `x-api-key: <AGENT_API_KEY>`.

Payload is stored in Supabase table `agent_sync_queue` when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set on Vercel.

---

## kroll_tray_helper.py — keystroke bridge

Binds to `127.0.0.1:48120`. Never talks to the internet.

```powershell
python kroll_tray_helper.py --verbose
```

| Method | Path | Purpose |
|--------|------|--------|
| `GET` | `/health` | Liveness probe |
| `POST` | `/autofill` | Replay one prescription line into the PMS |

See source for key mappings (Kroll F3/F5/F7, Propel, WinRx).

### Build .exe (optional)

```powershell
pip install pyinstaller
pyinstaller --noconfirm --onefile --noconsole --name kroll_tray_helper kroll_tray_helper.py
```

---

## Safety

- `flow.py` is **read-only** against Kroll SQL.
- `kroll_tray_helper.py` only injects keystrokes; it never writes clinical decisions.
- Passwords live only in local `config.ini` (gitignored) and Vercel env vars.
