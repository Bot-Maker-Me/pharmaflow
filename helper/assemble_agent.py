"""Build flow_body.py from agent_part_*.b64 in this folder.\nRun once: python assemble_agent.py\n"""
from pathlib import Path
import base64
import zlib
import sys

parts = sorted(Path(__file__).parent.glob("agent_part_*.b64"))
if not parts:
    print("No agent_part_*.b64 files found")
    sys.exit(1)
data = "".join(p.read_text(encoding="ascii").strip() for p in parts)
code = zlib.decompress(base64.b64decode(data))
out = Path(__file__).parent / "flow_body.py"
out.write_bytes(code)
print("Wrote", out, len(code), "bytes")
print("Next: python flow.py --test")
