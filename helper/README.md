# PharmFlow local desktop helpers

Full step-by-step guide: [`docs/SETUP.md`](../docs/SETUP.md).

| Script | Runs on | Role |
|--------|---------|------|
| `flow.py` | Kroll **server** PC | Read-only SQL poller of `PendingNewRx` → cloud (`--discover`, `--test`, SHADOW/LIVE) |
| `kroll_tray_helper.py` | Pharmacist **work** PC | Keystroke bridge on `127.0.0.1:48120` (`--dry-run`, origin allow-list, window check) |

Quick commands:

```powershell
python flow.py --discover      # list DB tables/columns, then fix [Schema] in config.ini
python flow.py --test          # connect + one poll
python flow.py                 # run the loop
python kroll_tray_helper.py --dry-run --verbose   # no keystrokes sent
```

Safety: `flow.py` only issues SELECTs and never logs patient data; the helper only types into the focused
PMS window and never talks to the internet. Secrets live in `config.ini` (gitignored) and Vercel env vars.
