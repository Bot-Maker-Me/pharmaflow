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

## flow_body.py (the Kroll poller)

`flow.py` is a small launcher; the real agent is `flow_body.py` in this folder (committed to the repo).
It reads `PendingNewRx`, loads the fax image (`ScriptImageId`) through `kroll_images.py`, sends it to
`/api/agent-rx` for Claude vision OCR, and (SHADOW) sends staff-vs-agent differences to `/api/learn`.
Requires `Pillow` for image compression: `pip install -r requirements.txt`.

## Missing DIN

When the fax has no DIN, PharmFlow looks for it in this order (it never guesses):
1. The drug already on the Kroll Rx (`DrugId` -> Kroll drug table DIN).
2. Kroll's drug table searched by name + strength, most-dispensed product first (clear-cut winners are filled, otherwise the options are shown).
3. Health Canada's Drug Product Database (marketed products only; filled only if exactly one matches).
Anything auto-filled is marked "please confirm" in Verify, and several matches appear as clickable choices.
