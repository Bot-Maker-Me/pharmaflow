# Restore flow.py + enable auto-learn

If `helper/flow.py` was corrupted, restore the last good agent then apply auto-learn.

## On the pharmacy PC (or any clone)

```bat
cd C:\PharmFlow\helper
git fetch origin
git checkout 0200207ed8a34df20745798e85433eddcaf03acd -- flow.py
```

Or download the file from GitHub at commit `0200207` path `helper/flow.py`.

## Enable auto-learn (manual if patch fails)

1. In `config.ini` under `[Shadow]` add:

```ini
AUTO_LEARN = true
```

2. Ensure `shadow_learn.py` is in the same folder as `flow.py` (already on main).

3. Apply the small code hooks from `AUTO_LEARN.patch` (or pull latest main after flow.py is restored and re-apply).

4. Restart the agent:

```powershell
Stop-ScheduledTask -TaskName "PharmFlow Agent"
Start-ScheduledTask -TaskName "PharmFlow Agent"
```

## What auto-learn does

Every ~10 minutes in SHADOW, when staff have completed an Rx in Kroll:
- Agent compares its planned fields to staff-entered `dbo.Rx`
- On mismatch, POSTs corrections to `/api/learn` (source=`shadow_staff`)
- Mappings accumulate in Supabase `learned_mappings` / `extraction_feedback`

Cloud must be configured (`API_URL` + `API_KEY`) for learning uploads.
