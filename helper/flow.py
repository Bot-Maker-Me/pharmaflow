"""PharmFlow agent entrypoint.

Requires flow_body.py in this folder (from git pull or recover_agent.py).
"""
from __future__ import annotations

import pathlib
import runpy
import sys

BASE = pathlib.Path(__file__).resolve().parent
BODY = BASE / "flow_body.py"


def main():
    if not BODY.exists() or BODY.stat().st_size < 10000:
        sys.stderr.write(
            "\n[PharmFlow] Missing flow_body.py\n"
            "Fix: put flow_body.py next to flow.py (see helper/AGENT_RECOVER.md)\n"
            "Then: python flow.py --test\n\n"
        )
        sys.exit(2)
    runpy.run_path(str(BODY), run_name="__main__")


if __name__ == "__main__":
    main()
