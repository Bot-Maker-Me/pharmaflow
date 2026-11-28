"""Read-only probe #2: what the fax list and the Rx Dropoff Form expose (positions, row counts, text SHAPE only).

Double-click Probe-Kroll-Fields.bat. Nothing is clicked or typed.
Privacy: every piece of text is masked (digits -> 9, letters -> a), so only the FORMAT is written, never names,
numbers or drug text.
"""
import re
import sys

from pywinauto import Desktop


def mask(t):
    t = re.sub(r"[0-9]", "9", t or "")
    return re.sub(r"[A-Za-z]", "a", t)[:60]


def kroll_windows():
    import psutil

    out = []
    for w in Desktop(backend="uia").windows():
        try:
            if psutil.Process(w.process_id()).name().lower() == "fill.exe":
                out.append(w)
        except Exception:  # noqa: BLE001
            pass
    return out


def walk(ctrl, depth=0):
    yield ctrl, depth
    try:
        for k in ctrl.children():
            yield from walk(k, depth + 1)
    except Exception:  # noqa: BLE001
        return


def rect(c):
    try:
        r = c.rectangle()
        return f"L{r.left} T{r.top} W{r.width()} H{r.height()}"
    except Exception:  # noqa: BLE001
        return "no-rect"


def text_of(c):
    try:
        return c.element_info.name or c.window_text() or ""
    except Exception:  # noqa: BLE001
        return ""


def value_of(c):
    try:
        return c.iface_value.CurrentValue
    except Exception:  # noqa: BLE001
        return None


def fax_list(out):
    for w in kroll_windows():
        for c, _ in walk(w):
            i = c.element_info
            if i.automation_id == "Grid_dbgGrid":
                rows = [k for k in c.children() if (k.element_info.automation_id or "").startswith("Row ")]
                out.append(f"grid Grid_dbgGrid rect={rect(c)} rows={len(rows)}")
                for r in rows:
                    cells = [mask(text_of(k)) + "|val=" + mask(str(value_of(k) or "")) for k in r.children()]
                    out.append(f"  {r.element_info.automation_id} rect={rect(r)} selected={getattr(r.element_info, 'selected', '?')} cells={cells}")
            if i.automation_id in ("cmbAnonymousMailSource", "cmbAnonymousMailType"):
                out.append(f"filter {i.automation_id} text={text_of(c)!r} value={value_of(c)!r}")
    # status / waiting counters
    for w in kroll_windows():
        for c, _ in walk(w):
            if c.element_info.control_type == "Text":
                t = text_of(c)
                if t and any(ch.isdigit() for ch in t):
                    out.append(f"text-with-digits class={c.element_info.class_name} rect={rect(c)} shape={mask(t)!r}")


def dropoff(out):
    for w in kroll_windows():
        for c, _ in walk(w):
            i = c.element_info
            if i.control_type in ("Edit", "ComboBox", "CheckBox", "Button", "Text") and i.class_name in (
                    "TKwwFormatDBEdit", "TEdit", "TMemo", "TComboBox", "TKwwDBComboBox", "TCheckBox", "TButton",
                    "TBitBtn", "TStaticText", "Edit"):
                out.append(f"{i.control_type:9} class={i.class_name:16} id={i.automation_id or '':12} rect={rect(c)} "
                           f"name={mask(i.name or '')!r} value={mask(str(value_of(c) or ''))!r}")


def main():
    out = []
    input("\nOpen Kroll on the INBOUND DOCS fax list (one fax selected), then press Enter... ")
    out.append("===== INBOUND DOCS LIST =====")
    fax_list(out)
    input("\nNow open the RX DROPOFF FORM (Use to process -> Process), then press Enter... ")
    out.append("\n===== RX DROPOFF FORM =====")
    dropoff(out)
    with open("kroll_fields_probe.txt", "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    print("\nDone: kroll_fields_probe.txt written (text is masked: only the format is saved).")


if __name__ == "__main__":
    sys.exit(main())
