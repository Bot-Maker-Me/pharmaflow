"""PharmFlow agent bootstrap — expands compressed body then runs it."""
from __future__ import annotations

import base64
import sys
import zlib
from pathlib import Path

_BASE = Path(__file__).resolve().parent
_CHUNKS = sorted(_BASE.glob("_flow_c*.b64"))
if not _CHUNKS:
    sys.stderr.write("Missing _flow_c*.b64 payload next to flow.py\n")
    sys.exit(1)

_b64 = "".join(p.read_text(encoding="ascii") for p in _CHUNKS)
_code = zlib.decompress(base64.b64decode(_b64))
# Execute as __main__ when run as script; expose module attrs when imported
_globals = {"__name__": "__main__" if __name__ == "__main__" else "flow", "__file__": str(_BASE / "flow_body.py")}
exec(compile(_code, str(_BASE / "flow_body.py"), "exec"), _globals)
