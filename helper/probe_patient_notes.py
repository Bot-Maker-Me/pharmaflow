"""Read-only probe: which Kroll tables hold patient comments / notes / allergies / conditions.

Run on the Kroll server (double-click Probe-Patient-Notes.bat). Prints table and column NAMES and row
counts only. No patient data is printed. Only SELECT on INFORMATION_SCHEMA and COUNT(*) WITH (NOLOCK).
"""
import logging

import flow

cfg = flow.AgentConfig(flow.CONFIG_PATH)
db = flow.KrollDB(cfg, logging.getLogger("probe"))
conn = db.ensure()
cur = conn.cursor()

PATTERNS = ["%Comment%", "%Note%", "%Alert%", "%Allerg%", "%Condition%", "%Warn%", "%Special%", "%Compl%", "%Pack%"]
where = " OR ".join(f"TABLE_NAME LIKE '{p}'" for p in PATTERNS)
cur.execute(f"SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' AND ({where}) "
            "AND TABLE_NAME NOT LIKE '%Hist' ORDER BY TABLE_NAME")
tables = [r[0] for r in cur.fetchall()]
print(f"{len(tables)} candidate tables\n")
for t in tables:
    try:
        cur.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=? ORDER BY ORDINAL_POSITION", t)
        cols = ", ".join(f"{c}:{d}" for c, d in cur.fetchall())
        cur.execute(f"SELECT COUNT(*) FROM dbo.[{t}] WITH (NOLOCK)")
        n = cur.fetchone()[0]
        print(f"== {t}  ({n} rows)\n   {cols}\n")
    except Exception as exc:  # noqa: BLE001
        print(f"== {t}  failed: {str(exc)[:100]}\n")
