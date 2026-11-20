# Setup on the Kroll PC without Git

You do NOT need Git. You only need the `helper` folder (as a ZIP) and Python.

## 1. Get the files onto the PC
Use any one of these:
- Copy `pharmflow-helper.zip` (sent in chat) to the Kroll PC with a USB stick or email.
- Or on any PC: open https://github.com/Bot-Maker-Me/pharmaflow, click **Code -> Download ZIP**
  (log in to GitHub if the repo is private), then copy the ZIP over.

Unzip so the files sit in `C:\PharmFlow\helper` (flow.py, flow_body.py, kroll_images.py, requirements.txt ...).
Updating later: unzip over the old folder, but KEEP your `config.ini`.

## 2. Install the programs (once)
1. Python 3.11 or newer from python.org. Tick **"Add python.exe to PATH"**.
2. "ODBC Driver 17 for SQL Server" from Microsoft (needed if the Kroll DB is SQL Server, see section 5).

## 3. Create the environment (Command Prompt, run as Administrator)
```bat
cd C:\PharmFlow\helper
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy config.ini.example config.ini
notepad config.ini
```
(The folder must be named `.venv` with the dot, `install_service.ps1` expects that.)

In `config.ini` set:
- `[Database]` SERVER, DATABASE, UID, PWD of the Kroll database
- `[Cloud]` API_URL = https://pharmaflow-swart.vercel.app/api/sync-queue
- `[Cloud]` API_KEY = the same value as AGENT_API_KEY in Vercel
- `[Agent]` MODE = SHADOW first

## 4. Test, then go live
```bat
python flow.py --test          :: checks database + cloud connection
python flow.py --discover      :: lists the tables/columns it found
python flow.py --find-images   :: finds where the fax images are stored
```
When the log shows the fax image table and the drug table, set `MODE = LIVE` in config.ini, then install it as a
background task (Administrator PowerShell):
```powershell
powershell -ExecutionPolicy Bypass -File .\install_service.ps1
```

## 5. Which database is it?
Run `SELECT @@VERSION;` (SQL Server) or `SELECT VERSION();` (MySQL) in the tool the pharmacy uses.
The agent currently speaks SQL Server (pyodbc). Use `find_kroll_tables.sql` for SQL Server and
`find_kroll_tables_mysql.sql` for MySQL. If it really is MySQL, send me the results and the agent needs a MySQL mode added.
