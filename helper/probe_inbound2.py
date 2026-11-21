"""Read-only probe 2: look for the Kroll "Inbound Docs" fax list in the Mail / fax tables.

Run on the Kroll server:   python probe_inbound2.py > probe2.txt
Only SELECT ... WITH (NOLOCK) / INFORMATION_SCHEMA. Long values are cut to 40 chars, binary is not printed.
"""
import logging

import flow

cfg = flow.AgentConfig(flow.CONFIG_PATH)
db = flow.KrollDB(cfg, logging.getLogger("probe"))
conn = db.ensure()
cur = conn.cursor()


def cell(v):
    if v is None:
        return ""
    if isinstance(v, (bytes, bytearray)):
        return f"<{len(v)} bytes>"
    return str(v).replace("\n", " ")[:40]


def show(title, sql):
    print(f"\n=== {title}")
    try:
        cur.execute(sql)
        cols = [c[0] for c in cur.description]
        print(" | ".join(cols))
        for r in cur.fetchall():
            print(" | ".join(cell(v) for v in r))
    except Exception as exc:  # noqa: BLE001
        print("  failed:", str(exc)[:200])


show("Tables with fax/inbound/incoming/receiv/doc/mail in the name",
     "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' AND "
     "(TABLE_NAME LIKE '%Fax%' OR TABLE_NAME LIKE '%Inbound%' OR TABLE_NAME LIKE '%Incoming%' "
     "OR TABLE_NAME LIKE '%Receiv%' OR TABLE_NAME LIKE '%Doc%' OR TABLE_NAME LIKE 'Mail%') "
     "AND TABLE_NAME NOT LIKE '%Hist' ORDER BY TABLE_NAME")
for t in ("Mail", "MailAttachment", "MailRecipient"):
    show(f"{t} columns",
         f"SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='{t}' ORDER BY ORDINAL_POSITION")
    show(f"{t} newest 8", f"SELECT TOP 8 * FROM dbo.{t} WITH (NOLOCK) ORDER BY 1 DESC")
