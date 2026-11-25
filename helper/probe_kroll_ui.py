"""Read-only probe: can Windows UI Automation see and press Kroll's controls?

Run on the PC where staff use Kroll (double-click Probe-Kroll-UI.bat). It asks you to open three Kroll
screens one after another and writes the control layout to kroll_ui_probe.txt.
Privacy: it prints control TYPES, ids and the captions of buttons/menus/tabs only. It never prints the text of
lists, edit boxes or labels, so no patient or fax details are written.
Nothing is clicked or typed.
"""
import sys

from pywinauto import Desktop

CAPTION_TYPES = {"Button", "MenuItem", "TabItem", "MenuBar", "ToolBar", "Hyperlink", "CheckBox", "RadioButton"}
MAX_DEPTH = 7
MAX_KIDS = 40


def dump(ctrl, out, depth=0):
    try:
        info = ctrl.element_info
        ctype = info.control_type or "?"
        cap = ""
        if ctype in CAPTION_TYPES:
            cap = (info.name or "").strip()[:40]
        line = "  " * depth + f"{ctype}  class={info.class_name or ''}  id={info.automation_id or ''}"
        if cap:
            line += f"  caption={cap!r}"
        out.append(line)
        if depth >= MAX_DEPTH:
            return
        kids = ctrl.children()
        for kid in kids[:MAX_KIDS]:
            dump(kid, out, depth + 1)
        if len(kids) > MAX_KIDS:
            out.append("  " * (depth + 1) + f"... {len(kids) - MAX_KIDS} more children (list rows etc. not printed)")
    except Exception as exc:  # noqa: BLE001
        out.append("  " * depth + f"<error reading control: {str(exc)[:60]}>")


def kroll_windows():
    import psutil

    wins = []
    for w in Desktop(backend="uia").windows():
        try:
            if psutil.Process(w.process_id()).name().lower() == "fill.exe":
                wins.append(w)
        except Exception:  # noqa: BLE001
            continue
    return wins


def main():
    out = []
    for label in ("INBOUND DOCS list (click the Inbound Docs tile)",
                  "SORT PAGES window (select a fax, press F2)",
                  "RX DROPOFF FORM (after choosing 'Use to process prescription(s)' and Process)"):
        input(f"\nOpen Kroll on: {label}\nThen press Enter here... ")
        out.append(f"\n===== {label} =====")
        wins = kroll_windows()
        out.append(f"{len(wins)} Kroll window(s) visible to UI Automation")
        for w in wins:
            out.append(f"--- window class={w.element_info.class_name!r} control_type={w.element_info.control_type!r}")
            dump(w, out)
    with open("kroll_ui_probe.txt", "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    print("\nDone: kroll_ui_probe.txt written (control types and button names only).")


if __name__ == "__main__":
    sys.exit(main())
