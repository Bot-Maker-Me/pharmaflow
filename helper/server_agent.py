"""
================================================================================
  PharmFlow — SERVER AGENT  (run this on the pharmacy SERVER / Kroll SQL PC)
================================================================================

This is the ONE command you run on the machine that can reach the Kroll
SQL Server database.

What it does:
  1. Polls Kroll's PendingNewRx table (READ-ONLY — never writes to Kroll)
  2. When a new fax arrives, loads the fax image from the database
  3. Sends the structured data + image to your Vercel cloud app for AI OCR
  4. In SHADOW mode: only records what it would do (safe testing)
  5. In LIVE mode: puts the prescription into the web queue for staff review

Quick start
-----------
  1. Copy config.ini.example → config.ini and fill in Database + Cloud sections
  2. python server_agent.py --test          # prove DB connection works
  3. python server_agent.py --discover      # see real table/column names
  4. python server_agent.py                 # start polling (MODE=SHADOW first!)

Other useful commands
---------------------
  python server_agent.py --schema-report
  python server_agent.py --find-images
  python server_agent.py --shadow-report
  python server_agent.py --skip-backlog

Safety
------
  * Only SELECT statements — never INSERT / UPDATE / DELETE on Kroll
  * Patient names / DOBs / addresses are NEVER written to the log file
  * Cloud URL must be https://
  * Start in SHADOW mode for at least one week before switching to LIVE
================================================================================
"""
from __future__ import annotations

import pathlib
import runpy
import sys

BASE = pathlib.Path(__file__).resolve().parent
BODY = BASE / "flow_body.py"


def main() -> None:
    if not BODY.exists() or BODY.stat().st_size < 10000:
        sys.stderr.write(
            "\n[PharmFlow] Missing flow_body.py next to server_agent.py\n"
            "Pull the latest repo or restore flow_body.py, then retry.\n\n"
        )
        sys.exit(2)
    # Hand off to the full agent implementation (same folder).
    runpy.run_path(str(BODY), run_name="__main__")


if __name__ == "__main__":
    main()
