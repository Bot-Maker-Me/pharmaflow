# PharmFlow — deployment checklist (shadow-week ready)

Status of what is already done for you: code merged to `main`, Vercel production deploy live, Supabase tables +
nightly report job (pg_cron) installed, row-level security on. Everything below is what is **left for you**.
Tick them in order.

## A. Vercel (10 minutes, from any browser)

1. **Let the agent reach the API.** Vercel → *pharmaflow* → Settings → **Deployment Protection**.
   - Recommended: under *Protection Bypass for Automation* click **Add**, copy the token → this is
     `VERCEL_BYPASS_TOKEN` for `config.ini` (Part B).
   - Alternative: set Vercel Authentication to *Only Preview Deployments*. (API stays key-protected.)
2. **Rotate the agent key** (the existing one is stored as a readable variable). Generate:
   `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
   Then Settings → Environment Variables → delete `AGENT_API_KEY`, add it again with that value, tick
   **Sensitive**, environments: Production. (>= 24 characters. You will paste the same value into `config.ini`.)
3. **Add the other variables** (Production, tick Sensitive):
   | Name | Value |
   |------|-------|
   | `EXTRACT_ACCESS_TOKEN` | another random value from the command above (also protects `/api/queue`) |
   | `ANTHROPIC_API_KEY` | from console.anthropic.com → API keys (see docs/SETUP.md "Extraction key") |
   | `REPORT_SECRET`, `RESEND_API_KEY`, `REPORT_EMAIL_TO`, `REPORT_EMAIL_FROM` | only if you want the nightly report by e-mail |
4. **Redeploy**: Deployments → latest → ⋯ → *Redeploy* (variables apply to new deployments only).
5. **Check**: replace the URL/key and run
   ```
   curl -i https://pharmaflow-swart.vercel.app/api/sync-queue                       # 401 = protected, good
   curl -s -H "x-api-key: YOUR_AGENT_API_KEY" https://pharmaflow-swart.vercel.app/api/sync-queue
   ```
   The second must print `{"ok":true,"count":0,...}`. A Vercel login page or 403 means step 1 is not done.

## B. Kroll server PC (30 minutes, one time)

See `docs/SETUP.md` Part 2 for details. In order:
1. Install Python 3.10+ **for all users**, and "ODBC Driver 17 for SQL Server". Copy the `helper` folder to `C:\PharmFlow\helper`.
2. `python -m venv .venv`, `.venv\Scripts\activate`, `pip install -r requirements.txt`.
3. `copy config.ini.example config.ini`, then fill: `[Database]` (read-only login), `[Cloud] API_URL` (+ `API_KEY` from A2,
   `VERCEL_BYPASS_TOKEN` from A1), `STORE_ID` (e.g. `henderson`), keep `MODE = SHADOW`.
4. `python flow.py --schema-report` → send `schema_report.txt` to your developer (columns only, no patient data);
   paste the proposed `[Schema]` and a `[RxSchema]` block into `config.ini`.
5. `python flow.py --test` must print `TEST OK`. Then `python flow.py` for a few minutes; the log must show `Synced PendingRxId=...`.
6. Administrator PowerShell: `powershell -ExecutionPolicy Bypass -File .\install_service.ps1` (runs 24/7, survives reboot).

## C. Supabase nightly report (5 minutes, optional e-mail)

Already installed. Default: 8 PM America/Toronto. Change time/zone and connect e-mail with the SQL in
`docs/SETUP.md` ("Nightly report"). Test any time:
`select public.generate_shadow_report('henderson', now() - interval '24 hours', now());`

## D. The shadow week

Leave it running 7 days → read the nightly reports → `python flow.py --shadow-report` → tune rules → reset
(`shadow_queue.db`) → repeat until the verdict says READY. Nothing is typed into Kroll and nothing is billed in this phase.

## What is NOT ready (do not skip)

- Kroll table/column names and hotkeys are unverified until step B4 / a test-patient run.
- Billing and claims automation is not built; keystroke automation (`kroll_tray_helper.py`) is not part of the shadow week.
- The web app has no user login; its data calls are protected by the access token only. Do not share the token.
- Get the pharmacy owner's written approval before real patient data goes to Supabase / Anthropic.
