# Setting up a pharmacy PC

Two programs, see `helper/README.md` for the long version.

| Program | PC | Job |
|---|---|---|
| `flow.py` | the Kroll server (once) | reads faxes + Kroll data in the background, learns from staff |
| `workstation_helper.py` | every PC where staff push prescriptions | types the verified prescription into Kroll |

Staff only use the web app (Intake page). Learning and the SQL reading are never shown there.

## Workstation (push to Kroll)
1. `cd C:\PharmFlow\helper`, `python -m venv .venv`, `.venv\Scripts\activate`, `pip install -r requirements.txt`
2. `config.ini` needs only a `[Helper]` section: `TOKEN` (any long random text), `WINDOW_KROLL` (see below).
3. Find the window text: `python workstation_helper.py --show-window`, click into Kroll within 5 seconds, copy part of the title into `WINDOW_KROLL`.
4. Safe test (no keys sent): `python workstation_helper.py --dry-run --verbose`
5. Real: `python workstation_helper.py` (leave it running, tray icon).
6. Web app -> Settings: Helper URL `http://localhost:48120`, Helper token = `TOKEN`, PMS = Kroll.

A fax counts as pushed only when the helper really typed it (not simulated). Then the agent compares the final Kroll
Rx with what was pushed and learns from sig changes.
