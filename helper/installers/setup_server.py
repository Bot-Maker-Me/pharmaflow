"""PharmFlow - new pharmacy setup wizard (runs on that pharmacy's Kroll server).

Asks a few questions and writes config.ini next to flow.py. Started by New-Pharmacy-Server.bat.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CFG = HERE / "config.ini"
EXAMPLE = HERE / "config.ini.example"


def ask(label, default="", secret_hint=False):
    suffix = f" [{default}]" if default else ""
    while True:
        value = input(f"  {label}{suffix}: ").strip()
        if value:
            return value
        if default:
            return default
        print("    (cannot be empty)")


def set_key(text, section, key, value):
    """Replace `key = ...` inside [section] (keeps the rest of the file as is)."""
    out, current, done = [], None, False
    for line in text.splitlines():
        m = re.match(r"\s*\[(.+?)\]\s*$", line)
        if m:
            current = m.group(1)
        if (not done and current == section and re.match(rf"\s*{re.escape(key)}\s*=", line)):
            out.append(f"{key} = {value}")
            done = True
            continue
        out.append(line)
    if not done:
        raise SystemExit(f"config.ini.example has no [{section}] {key}")
    return "\n".join(out) + "\n"


def main():
    if not EXAMPLE.exists():
        print("config.ini.example is missing from this folder.")
        return 1
    if CFG.exists():
        again = input("  config.ini already exists. Replace it? (y/N): ").strip().lower()
        if again != "y":
            print("  Keeping the existing config.ini.")
            return 0

    print("\n  Answer a few questions. Press Enter to accept the value in [brackets].\n")
    store = re.sub(r"[^a-z0-9-]", "", ask("Pharmacy short name, no spaces (e.g. henderson)").lower())
    if not store:
        print("  Name must contain letters or numbers.")
        return 1
    server = ask("Kroll SQL server name", "localhost")
    database = ask("Kroll database name", "Pharmacy")
    uid = ask("SQL user (read-only login for PharmFlow)")
    pwd = ask("SQL password")
    api_key = ask("PharmFlow agent key for this pharmacy (given by Apex Digital)")
    api_url = ask("PharmFlow cloud address", "https://pharmaflow-swart.vercel.app/api/sync-queue")

    driver = "ODBC Driver 17 for SQL Server"
    try:
        import pyodbc
        found = [d for d in pyodbc.drivers() if "SQL Server" in d]
        if found:
            driver = sorted(found)[-1]
    except Exception:  # noqa: BLE001
        pass
    print(f"\n  Using ODBC driver: {driver}")

    text = EXAMPLE.read_text(encoding="utf-8")
    for sec, key, val in [
        ("Agent", "STORE_ID", store), ("Agent", "MODE", "SHADOW"),
        ("Database", "SERVER", server), ("Database", "DATABASE", database),
        ("Database", "UID", uid), ("Database", "PWD", pwd), ("Database", "DRIVER", driver),
        ("Cloud", "API_URL", api_url),
    ]:
        text = set_key(text, sec, key, val)
    # API_KEY line in the example carries an inline comment; replace the whole line
    text = re.sub(r"(?m)^API_KEY\s*=.*$", f"API_KEY = {api_key}", text)
    CFG.write_text(text, encoding="utf-8")
    print("  config.ini written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
