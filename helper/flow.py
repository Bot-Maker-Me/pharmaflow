"""PharmFlow agent — expands local payload (no network required)."""
from __future__ import annotations

import base64
import sys
import zlib
from pathlib import Path

_BASE = Path(__file__).resolve().parent
_CHUNKS = sorted(_BASE.glob("_agent_c*.b64"))
if not _CHUNKS:
    sys.stderr.write(
        "Missing _agent_c*.b64 next to flow.py.\n"
        "Copy the full helper folder from GitHub (git pull).\n"
    )
    sys.exit(1)

_code = zlib.decompress(base64.b64decode("".join(p.read_text(encoding="ascii") for p in _CHUNKS)))
_globals = {
    "__name__": "__main__" if __name__ == "__main__" else "flow",
    "__file__": str(_BASE / "flow_body.py"),
}
exec(compile(_code, str(_BASE / "flow_body.py"), "exec"), _globals)
