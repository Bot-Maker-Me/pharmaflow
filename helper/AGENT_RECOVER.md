# Agent offline recovery (404 / install_service failed)

The agent no longer downloads from GitHub (private repos return 404).

## On the Kroll server PC

```bat
cd C:\PharmFlow\helper
git pull
```

You need these files next to each other:
- `flow.py`
- `_agent_c0.b64` … `_agent_c3.b64`
- `shadow_learn.py`
- `config.ini`

Then:

```powershell
.\.venv\Scripts\activate
python flow.py --test
```

If test OK:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_service.ps1
```

Or without the service (manual):

```powershell
python flow.py
```

Restart task (PowerShell, not cmd):

```powershell
Stop-ScheduledTask -TaskName "PharmFlow Agent"
Start-ScheduledTask -TaskName "PharmFlow Agent"
```

In **cmd.exe** use:

```bat
powershell -Command "Stop-ScheduledTask -TaskName 'PharmFlow Agent'; Start-ScheduledTask -TaskName 'PharmFlow Agent'"
```
