# PharmFlow local helpers — simplified layout

You only need to run **two** programs.

| File you run | Where | What it does |
|--------------|-------|--------------|
| **`flow.py`** | **One** pharmacy server PC (can reach Kroll SQL) | Polls Kroll SQL, reads fax images → AI OCR → cloud queue, and keeps learning (see below) |
| **`workstation_helper.py`** | **Every** pharmacist PC | Types verified Rx into the focused Kroll window |

`flow.py` is self-contained: SQL poller, fax image reader, cloud sync and learning live in that one file.

The **Vercel web app** is the shared UI. Open the same URL on any PC.
Staff review the queue there and click **Push**. The workstation helper only
needs to be running on the PC they are sitting at.

---

## 1. Server PC (run once)

```powershell
cd C:\PharmFlow\helper
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy config.ini.example config.ini
notepad config.ini          # fill [Database] and [Cloud]
```

```powershell
python flow.py --test          # must print TEST OK
python flow.py --discover      # check real column names
python flow.py                 # start (leave MODE=SHADOW first)
```

To keep it running after reboot:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_service.ps1
```

## 2. Each workstation

```powershell
cd C:\PharmFlow\helper
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
# create config.ini with only the [Helper] section (see config.ini.example)
python workstation_helper.py --dry-run --verbose   # safe test
python workstation_helper.py                       # real mode
```

In the web app → **Settings**:
- Helper URL = `http://localhost:48120`
- Helper token = same value as `TOKEN` in config.ini
- PMS = Kroll

## 3. Vercel web app (already deployed)

**Yes — open the same Vercel URL on every PC.** It is the central dashboard.
No install needed for the UI itself. Only the workstation helper is local.

---

## Safety rules

- `flow.py` only runs `SELECT` queries. It never writes to Kroll.
- Start in `MODE = SHADOW` for a week. Compare with `--shadow-report` before going `LIVE`.
- `workstation_helper.py` only types when the Kroll window is focused.
- Get written permission from the pharmacy owner before connecting to the live database.


---

## Learning (flow.py)

Everything learned is stored permanently in `helper/learning.db` (never reset with the queue, so back it up
with the rest of the folder) and mirrored to the cloud.

1. **Background, from SQL** - every 15 min flow.py reads finished prescriptions from Kroll (read-only, needs
   `[RxSchema]`) and learns the usual sig per drug and per prescriber. When a pending Rx arrives with no sig, it is
   sent to the web app with a *suggested sig* (never filled in silently).
2. **From staff corrections** - after an Rx is entered in Kroll, flow.py compares it with what PharmFlow planned.
   If staff changed the sig, the right sig is remembered for that drug. After `SIG_APPLY_MIN_HITS` (default 2)
   identical fixes it is applied automatically next time, but only if it is a wording/note fix (LU code, NOT COVERED,
   UNWRAP...). A fix that changes a dose, number or frequency stays a hint for staff (`SIG_APPLY_SAFE_ONLY`, default
   true). If staff undo an applied rule, it is removed. Quantity, refills and drug changes are recorded but never
   auto-applied.

```powershell
python flow.py --learning-report     # what has been learned so far
python flow.py --gen-key             # new random agent API key
```
