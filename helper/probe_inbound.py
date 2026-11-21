"""Read-only probe: find where Kroll keeps the "Inbound Docs" list (faxes waiting to be filed).

Run on the Kroll server:   python probe_inbound.py
Only SELECT ... WITH (NOLOCK). Prints ids, dates, status codes and the fax-number description (no images).
"""
import logging

import flow

cfg = flow.AgentConfig(flow.CONFIG_PATH)
db = flow.KrollDB(cfg, logging.getLogger("probe"))
conn = db.ensure()
cur = conn.cursor()


def show(title, sql):
    print(f"\n=== {title}")
    try:
        cur.execute(sql)
        cols = [c[0] for c in cur.description]
        print(" | ".join(cols))
        for r in cur.fetchall():
            print(" | ".join("" if v is None else str(v)[:40] for v in r))
    except Exception as exc:  # noqa: BLE001
        print("  failed:", str(exc)[:200])


show("DocumentScan by Status (count, newest)",
     "SELECT Status, COUNT(*) AS n, MAX(ScanDate) AS newest FROM dbo.DocumentScan WITH (NOLOCK) GROUP BY Status ORDER BY Status")
show("DocumentScan newest 30",
     "SELECT TOP 30 Id, ScanDate, Status, DocumentScanType, ContentLocation, ScriptImageId, DocumentScanContentId, "
     "PatId, DocId, PageCount, FiledByInit, Description "
     "FROM dbo.DocumentScan WITH (NOLOCK) ORDER BY Id DESC")
show("ScriptImage newest 10 (not yet linked to a patient/doctor)",
     "SELECT TOP 10 Id, ScanDate, ScriptImageType, PatId, DocId, PageCount, LinkedInWorkflow, Description, ReferenceNumber "
     "FROM dbo.ScriptImage WITH (NOLOCK) ORDER BY Id DESC")
show("zzFaxCount columns",
     "SELECT TOP 5 * FROM dbo.zzFaxCount WITH (NOLOCK)")
