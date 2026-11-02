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
3. **Get the extraction (AI) key** — see "Extraction key" below. Without it, Live extraction cannot work.
4. Deploy. Then check the API is protected and alive (replace the URL and key):
   ```
   curl -i https://YOUR-APP.vercel.app/api/sync-queue                      # expect 401
   curl -s -H "x-api-key: YOUR_AGENT_API_KEY" https://YOUR-APP.vercel.app/api/sync-queue   # expect {"ok":true,"count":0,...}
   ```

### Extraction key (Anthropic API key) — step by step

The web app reads faxed prescriptions with a vision model. The call happens on Vercel (`/api/extract`), so the key
never reaches a browser.

1. Go to the **Claude Console** (console.anthropic.com), sign in or create an account.
2. **Billing**: add a payment method / prepaid credits (API usage is billed separately from a Claude chat plan).
3. **API keys → Create key**, name it `pharmaflow-prod`. Copy it immediately; it is shown only once.
4. **Vercel → pharmaflow → Settings → Environment Variables**: add `ANTHROPIC_API_KEY` = that key
   (Production, mark *Sensitive*).
5. Create the app's own access token (any 32+ random chars) and add it as `EXTRACT_ACCESS_TOKEN`:
   ```
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
6. **Redeploy** (Vercel → Deployments → ⋯ → Redeploy) so the variables are picked up.
7. In the web app → **Settings**: *Extraction mode = Live*, *API access token* = the `EXTRACT_ACCESS_TOKEN` value.
8. Optional: set a monthly **spend limit** in the Console, and `EXTRACT_MODEL` in Vercel to pick another model.

Privacy: fax images contain PHI and are sent to Anthropic's API for processing. Get the pharmacy's privacy
officer to approve this and review Anthropic's current data-retention terms first.

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
3. **Verify the Kroll table/column names.** Table names come from your own table list; column names are
   still guesses until checked. Run:
   ```powershell
   python flow.py --schema-report
   ```
   It writes `schema_report.txt` (column names, types and primary keys for the 19 Kroll tables PharmFlow uses —
   **no patient data**) and prints a proposed `[Schema]` block. Lines marked `# CHECK` or `?` need a human look.
   Paste the proposed block into `config.ini` (fix any wrong lines), then:
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
6. **Run it 24/7 (survives closing the terminal and reboots).** In an **Administrator** PowerShell:
   ```powershell
   cd C:\PharmFlow\helper
   powershell -ExecutionPolicy Bypass -File .\install_service.ps1
   ```
   It tests the config, locks `config.ini` to SYSTEM/Administrators, registers a hidden Windows task *PharmFlow Agent*
   that starts at boot and restarts itself within a minute if it crashes, and stops the PC sleeping.
   Python must be installed **for all users** (e.g. `C:\Program Files\Python312`), not inside one user's profile,
   because the task runs as SYSTEM. Remove it any time with `.\uninstall_service.ps1`.
   Closing the terminal only stops a `python flow.py` you started by hand; the installed task keeps running.

**Install `flow.py` on ONE PC only** (the Kroll server PC, or any always-on PC that can reach the SQL Server) — not on
every workstation. Staff open the web app in a browser (nothing to install). The keystroke helper is only for
workstations and only once automatic typing is enabled; it is not needed during the shadow week.

### Shadow week (compare before going automatic)

In `MODE = SHADOW`, `flow.py` types nothing and changes nothing in Kroll. With `[Cloud]` filled in it records every
pending prescription **and its decision into Supabase**, and every 10 minutes looks up what staff actually entered
(`[RxSchema]`) and uploads the comparison. For every pending prescription it records a decision:
**AUTO** (nothing needed a human judgement) or **EXCEPTION** (e.g. prescriber has no licence, no insurance plan,
no sig, quantity 0) plus the exact values it *would* have entered.

1. Fill `[RxSchema]` in `config.ini` from `schema_report.txt` (the table where finished prescriptions live and its
   patient / doctor / drug / qty / refills / sig / created columns).
2. Leave `python flow.py` running for 7 days, then run:
   ```powershell
   python flow.py --shadow-report
   ```
   It compares each AUTO decision with what staff actually entered in Kroll, prints a match rate per field,
   example mismatches (IDs only, no names), and a go-live verdict (default thresholds: 200+ compared, every field
   >= 99.5%, at least 80% of prescriptions automatic; tune in `[Shadow]`).
3. Look at the mismatch examples and exception reasons, adjust the rules (`validate_row` in `flow.py`) or
   `[Schema]`, **reset the week** (delete `shadow_queue.db`) and run another week. Repeat until the verdict is READY.
4. Going live is then a supervised pilot (EXCEPTION items always go to a person), not a switch to unattended
   billing. Claim submission itself must stay inside Kroll's own workflow.

### Nightly report (Supabase runs it, you get an e-mail)

Supabase's scheduler (`pg_cron`) runs `run_daily_shadow_report()` every hour; it acts once per day, in the hour set in
`shadow_report_settings` (default **20 = 8 PM, time zone America/Toronto**). It compares, per field, what the agent
would have done with what staff entered, lists mismatches (Kroll ids only), exception reasons and agent health
(heartbeats; it warns if the agent was silent for 30+ minutes), and stores it in table `shadow_reports`.

To get it by e-mail (optional, uses [Resend](https://resend.com)):
1. Create a Resend account + API key, and verify a sending domain/address.
2. Vercel env vars: `REPORT_SECRET` (random 32+ chars), `RESEND_API_KEY`, `REPORT_EMAIL_TO` (your address),
   `REPORT_EMAIL_FROM`. Redeploy.
3. In Supabase → SQL editor, point the database at the endpoint (values are stored privately, RLS on, no policies):
   ```sql
   update shadow_report_settings set value = 'https://pharmaflow-swart.vercel.app/api/daily-report' where key = 'webhook_url';
   update shadow_report_settings set value = '<same REPORT_SECRET>' where key = 'webhook_secret';
   -- only if Vercel Deployment Protection is on:
   update shadow_report_settings set value = '<bypass token>' where key = 'bypass_token';
   -- change when/where the report runs:
   update shadow_report_settings set value = '8' where key = 'send_hour';          -- e.g. 8 AM
   update shadow_report_settings set value = 'America/Vancouver' where key = 'timezone';
   ```
4. Test now: `select public.generate_shadow_report('default', now() - interval '24 hours', now());` then
   `select body from shadow_reports order by id desc limit 1;`

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

- The web app's **Kroll inbox** shows synced prescriptions; the health card and DIN are not in `PendingNewRx`, so the pharmacist fills them in Verification before pushing.
- There is **no billing / claim-reprocessing logic yet**: it needs the real columns of `Rx`, `RxPln`, `RxPlnAdj` and `RxWorkflow` (run `python flow.py --schema-report` and share `schema_report.txt`). Claims must never be written to Kroll's database directly; they are typed through Kroll's own screens with pharmacist approval.
- Kroll table names and hotkeys are unverified against a real installation (steps 2.3 and 3.3).
