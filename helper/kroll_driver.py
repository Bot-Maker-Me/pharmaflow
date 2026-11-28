"""Kroll UI driver, step 1: open one inbound fax as a prescription (Inbound Docs -> F2 -> Use to process -> Process).

Runs on the PC where Kroll is open (needs: pip install pywinauto psutil). It only drives the screens Kroll itself
offers; it never touches Kroll's database. Step 1 STOPS as soon as the Rx Dropoff Form is open - it types nothing
into the form and presses no Add/Finalize button.

  python kroll_driver.py --test-first        open the newest Pending fax (for a first test)
  python kroll_driver.py --test-fax "2026-11-28 06:58:25" 19056413693   open one specific fax

Every step is checked on screen; on any surprise it stops and says which step failed. It never retries a step that
may already have changed something.
"""
import argparse
import datetime as dt
import re
import sys
import time
from typing import Any, Dict, List, Optional

FAX_LIST_ID = "Grid_dbgGrid"
DEST_ID = "cmbDestination"
PROCESS_BTN_ID = "btnProcess"
SORT_CLASS = "TDocumentReconciliationForm"
DROPOFF_CLASS = "TRxWorkflowDropOffForm"
USE_TO_PROCESS = "process prescription"          # the choice "Use to process prescription(s)"
STEP_TIMEOUT = 12.0


# ---------- pure helpers (tested without Kroll) ----------
def parse_kroll_dt(text: str) -> Optional[dt.datetime]:
    """'27/11/2026 7:22:42 PM', '27/11/2026 19:22' or '2026-11-27 19:22:42' -> datetime (seconds optional)."""
    t = (text or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$", t)
    if m:
        y, mo, d, h, mi, s = (int(x or 0) for x in m.groups())
        return dt.datetime(y, mo, d, h, mi, s)
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$", t)
    if not m:
        return None
    d, mo, y, h, mi, s, ap = m.groups()
    h = int(h)
    if ap:
        h = h % 12 + (12 if ap.lower() == "pm" else 0)
    try:
        return dt.datetime(int(y), int(mo), int(d), h, int(mi), int(s or 0))
    except ValueError:
        return None


def digits(text: str) -> List[str]:
    return re.findall(r"\d{7,}", text or "")


def match_row(rows: List[Dict[str, str]], received_label: str, from_label: str) -> Dict[str, Any]:
    """Pick the list row for one fax: same minute AND a shared phone number. Exactly one match or no match."""
    want = parse_kroll_dt(received_label)
    nums = set(digits(from_label))
    hits = []
    for r in rows:
        got = parse_kroll_dt(r.get("date", ""))
        if not (want and got) or abs((got - want).total_seconds()) > 60:
            continue
        if nums and not (nums & set(digits(r.get("desc", "")))) and "unknown" not in (r.get("desc", "").lower()):
            continue
        hits.append(r)
    if len(hits) == 1:
        return {"ok": True, "row": hits[0]}
    return {"ok": False, "error": "no matching fax in Kroll's list" if not hits else f"{len(hits)} faxes look the same - needs a person"}


# ---------- Kroll screen access ----------
def _desktop():
    from pywinauto import Desktop
    return Desktop(backend="uia")


def kroll_windows() -> List[Any]:
    import psutil
    out = []
    for w in _desktop().windows():
        try:
            if psutil.Process(w.process_id()).name().lower() == "fill.exe":
                out.append(w)
        except Exception:  # noqa: BLE001
            pass
    return out


def _walk(ctrl: Any, depth: int = 0):
    yield ctrl
    if depth > 40:
        return
    try:
        kids = ctrl.children()
    except Exception:  # noqa: BLE001
        return
    for k in kids:
        yield from _walk(k, depth + 1)


def find(auto_id: str = "", class_name: str = "") -> Optional[Any]:
    """First control with this id / class in any Kroll window, or None (plain tree walk: the same way the probe saw them)."""
    for w in kroll_windows():
        for c in _walk(w):
            try:
                info = c.element_info
                if (auto_id and info.automation_id == auto_id) or (class_name and info.class_name == class_name):
                    return c
            except Exception:  # noqa: BLE001
                continue
    return None


def wait_for(auto_id: str = "", class_name: str = "", timeout: float = STEP_TIMEOUT) -> Optional[Any]:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        c = find(auto_id, class_name)
        if c is not None:
            return c
        time.sleep(0.3)
    return None


def _text(c: Any) -> str:
    try:
        return c.element_info.name or c.window_text() or ""
    except Exception:  # noqa: BLE001
        return ""


def read_fax_rows() -> List[Dict[str, Any]]:
    """Rows of the Inbound Docs list as {date, desc, ctrl}. Only rows Kroll currently shows."""
    grid = find(FAX_LIST_ID)
    if grid is None:
        return []
    rows = []
    for r in grid.children():
        if not (r.element_info.automation_id or "").startswith("Row "):
            continue
        cells = [_text(k) for k in r.children()]
        if len(cells) >= 2:
            rows.append({"date": cells[0], "desc": cells[1], "ctrl": r})
    return rows


def _focus_main() -> None:
    grid = find(FAX_LIST_ID)
    if grid is not None:
        top = grid.top_level_parent()
        top.set_focus()


def _dpi_aware() -> None:
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:  # noqa: BLE001
        pass


def highlighted_rows(rows: List[Dict[str, Any]]) -> List[int]:
    """Indexes of list rows drawn with Kroll's blue selection colour (read from the screen, so it is what a person sees)."""
    try:
        from PIL import ImageGrab
    except ImportError:
        return []
    hits = []
    for i, r in enumerate(rows):
        try:
            rc = r["ctrl"].rectangle()
            x0, x1 = rc.left + 6, rc.left + min(rc.width(), 240)
            y = (rc.top + rc.bottom) // 2
            img = ImageGrab.grab(bbox=(x0, y - 2, x1, y + 3), all_screens=True).convert("RGB")
            red, green, blue = img.resize((1, 1)).getpixel((0, 0))
            if max(red, green, blue) - min(red, green, blue) > 70 and blue > red + 40:
                hits.append(i)
        except Exception:  # noqa: BLE001
            continue
    return hits


def select_row(row: Dict[str, Any], log=print) -> bool:
    """Make `row` the selected fax and PROVE it from the screen. Click first; if another row is highlighted, walk
    there with the arrow keys; give up (False) if it still is not the one."""
    from pywinauto.keyboard import send_keys

    def same(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
        return a["date"] == b["date"] and a["desc"] == b["desc"]

    for attempt in range(3):
        rows = read_fax_rows()
        order = sorted(range(len(rows)), key=lambda i: rows[i]["ctrl"].rectangle().top)   # top-to-bottom as shown
        rows = [rows[i] for i in order]
        idx = next((i for i, r in enumerate(rows) if same(r, row)), None)
        if idx is None:
            log("the fax is no longer in the list")
            return False
        marked = highlighted_rows(rows)
        if marked == [idx]:
            log(f"fax selected (row {idx + 1} of {len(rows)})")
            return True
        if attempt == 0 or not marked:
            try:
                _focus_main()
                rc = rows[idx]["ctrl"].rectangle()
                from pywinauto import mouse
                mouse.click(button="left", coords=(rc.left + 40, (rc.top + rc.bottom) // 2))
            except Exception as exc:  # noqa: BLE001
                log(f"click failed: {str(exc)[:60]}")
        else:
            delta = idx - marked[0]
            log(f"walking {delta:+d} row(s) with the arrow keys (row {marked[0] + 1} was highlighted)")
            send_keys(("{DOWN}" if delta > 0 else "{UP}") * abs(delta))
        time.sleep(0.7)
    return False


def open_fax_as_prescription(row: Dict[str, Any], log=print) -> Dict[str, Any]:
    """Select the row, F2, 'Use to process prescription(s)', Process. Stops when the Rx Dropoff Form is open."""
    from pywinauto.keyboard import send_keys

    def fail(step: str, why: str) -> Dict[str, Any]:
        return {"ok": False, "step": step, "error": why}

    _dpi_aware()
    log("1/5 selecting the fax in Inbound Docs")
    if not select_row(row, log):
        return fail("select", "could not select the right fax (nothing was opened)")

    log("2/5 pressing F2")
    send_keys("{F2}")
    if wait_for(class_name=SORT_CLASS) is None:
        return fail("F2", "the sort-pages window did not open")

    log("3/5 choosing 'Use to process prescription(s)'")
    combo = wait_for(DEST_ID)
    if combo is None:
        return fail("destination", "the destination box was not found")

    def chosen() -> str:
        try:
            return (combo.iface_value.CurrentValue or "").lower()
        except Exception:  # noqa: BLE001
            return _text(combo).lower()

    if USE_TO_PROCESS not in chosen():
        try:
            combo.expand()
            time.sleep(0.4)
            for item in combo.descendants(control_type="ListItem"):
                if USE_TO_PROCESS in _text(item).lower():
                    item.click_input()
                    break
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.4)
        if USE_TO_PROCESS not in chosen():                    # fallback: type-ahead in the box
            try:
                combo.set_focus()
                send_keys("Use to process", with_spaces=True)
                send_keys("{ENTER}")
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.4)
    if USE_TO_PROCESS not in chosen():
        return fail("destination", "could not select 'Use to process prescription(s)' (nothing was processed)")

    log("4/5 pressing Process")
    btn = find(PROCESS_BTN_ID)
    if btn is None:
        return fail("process", "the Process button was not found")
    try:
        btn.invoke()
    except Exception:  # noqa: BLE001
        btn.click_input()

    log("5/5 waiting for the Rx Dropoff Form")
    if wait_for(class_name=DROPOFF_CLASS, timeout=20) is None:
        return fail("dropoff", "the Rx Dropoff Form did not open - check Kroll before trying again")
    return {"ok": True, "step": "dropoff-open"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test-first", action="store_true")
    ap.add_argument("--test-fax", nargs=2, metavar=("RECEIVED", "NUMBER"))
    a = ap.parse_args()
    rows = read_fax_rows()
    if not rows:
        print("Could not read Kroll's Inbound Docs list. Open Kroll to Inbound Docs (Show: Pending) first.")
        print(f"(Kroll windows seen: {len(kroll_windows())}; list control found: {find(FAX_LIST_ID) is not None})")
        return 1
    print(f"{len(rows)} fax row(s) visible in the list.")
    if a.test_fax:
        m = match_row([{"date": r["date"], "desc": r["desc"]} for r in rows], a.test_fax[0], a.test_fax[1])
        if not m["ok"]:
            print("STOP:", m["error"])
            return 1
        row = next(r for r in rows if r["date"] == m["row"]["date"] and r["desc"] == m["row"]["desc"])
    else:
        row = rows[0]
    res = open_fax_as_prescription(row)
    print("RESULT:", {k: v for k, v in res.items()})
    if res["ok"]:
        print("The Rx Dropoff Form is open. Nothing was typed and nothing was saved. Close the form yourself.")
    return 0 if res["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
