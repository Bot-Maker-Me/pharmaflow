# Agent recovery (offline / 404)

## Why agent is offline

Old `flow.py` tried to **download** the agent from GitHub. Private repos return **HTTP 404**, so `--test` and `install_service.ps1` fail and heartbeats stop.

## Fix on the Kroll server (C:\PharmFlow\helper)

### Option A — if you still have a working backup

If `flow_body.py` or an old full `flow.py` (>20KB with `class AgentConfig`) exists anywhere:

```bat
copy /Y path\to\good\flow.py C:\PharmFlow\helper\flow_body.py
```

Then use the new thin `flow.py` from git that only runs `flow_body.py`.

### Option B — git history on the server

```bat
cd C:\PharmFlow\helper
git fetch
git show 0200207ed8a34df20745798e85433eddcaf03acd:helper/flow.py > flow_body.py
```

(If that commit is in your clone history.)

### Option C — copy from a machine that has artifacts

Copy `flow_body.py` into `C:\PharmFlow\helper\` (must contain `class AgentConfig` and `def main`).

### Then test and restart

```powershell
cd C:\PharmFlow\helper
.\.venv\Scripts\activate
python flow.py --test
```

**PowerShell** (not cmd):

```powershell
Stop-ScheduledTask -TaskName "PharmFlow Agent"
Start-ScheduledTask -TaskName "PharmFlow Agent"
```

**cmd.exe**:

```bat
powershell -Command "Stop-ScheduledTask -TaskName 'PharmFlow Agent'; Start-ScheduledTask -TaskName 'PharmFlow Agent'"
```

Or install service again (Admin PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\install_service.ps1
```

## Vercel AGENT_API_KEY

Settings → Environment Variables → **Production** (and Preview if needed):

- Key: `AGENT_API_KEY`
- Value: same long secret as `config.ini` → `[Cloud] API_KEY`
- Apply to: **Production** (uncheck "Git Branch" filter / select All Environments)
- **Redeploy** after saving

If UI says "branch", choose **All Environments** or Production only, not a feature branch.

## Verification empty DIN / no image

Rows labeled **Manual entry** / `Kroll drug ####` come from the **SQL agent**, not fax AI:

- **No prescription image** — Kroll pending table has no page image in this path
- **DIN / strength** often empty on `PendingNewRx` — only internal `DrgId` exists until Drug table join / DPD lookup is wired
- Fax path needs Anthropic + upload of a fax PDF for image + vision fields

## Dual learning

1. **Passive (SHADOW):** agent compares to staff `dbo.Rx` → `/api/learn`
2. **Active (Verify UI):** when employee edits fields then Verify/Push → `/api/learn`
3. **Next extract:** mappings auto-applied
