"""Fetch and compress Kroll script images (ScriptImageId / RxScriptImage).

Used by flow_body.py. Safe no-op when tables/columns are missing.
"""
from __future__ import annotations

import base64
import io
import logging
from typing import Any, Dict, Optional

log = logging.getLogger("pharmflow.images")

IMAGE_TABLE_CANDIDATES = [
    ("dbo.RxScriptImage", "Id", "ImageData"),
    ("dbo.RxScriptImage", "ID", "ImageData"),
    ("dbo.ScriptImage", "Id", "ImageData"),
    ("dbo.ScriptImage", "ID", "Data"),
    ("dbo.PendingRxImage", "Id", "ImageData"),
    ("dbo.Image", "Id", "ImageData"),
]


def _try_pil_jpeg(raw: bytes, max_side: int = 1600, quality: int = 72) -> Optional[bytes]:
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return None
    try:
        img = Image.open(io.BytesIO(raw))
        img = img.convert("RGB")
        w, h = img.size
        scale = min(1.0, max_side / max(w, h))
        if scale < 1.0:
            img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue()
    except Exception as exc:
        log.warning("PIL compress failed: %s", exc)
        return None


def bytes_to_data_url(raw: bytes, max_b64_chars: int = 2_800_000) -> Optional[str]:
    if not raw:
        return None
    jpeg = _try_pil_jpeg(raw)
    if jpeg is None:
        if raw[:3] == b"\xff\xd8\xff":
            jpeg = raw
        else:
            log.warning("No PIL and not JPEG — cannot attach ScriptImage (%d bytes)", len(raw))
            return None
    b64 = base64.b64encode(jpeg).decode("ascii")
    if len(b64) > max_b64_chars:
        jpeg2 = _try_pil_jpeg(raw, max_side=1200, quality=55)
        if jpeg2:
            b64 = base64.b64encode(jpeg2).decode("ascii")
        if len(b64) > max_b64_chars:
            log.warning("ScriptImage still too large after compress (%d b64 chars) — skip", len(b64))
            return None
    return f"data:image/jpeg;base64,{b64}"


def fetch_image_bytes(conn, image_id: Any, schema: Dict[str, str]) -> Optional[bytes]:
    if image_id is None or image_id == "" or image_id == 0:
        return None
    table = (schema.get("image_table") or "").strip()
    id_col = (schema.get("image_id") or "Id").strip()
    data_col = (schema.get("image_data") or "ImageData").strip()
    candidates = []
    if table:
        candidates.append((table, id_col, data_col))
    candidates.extend(IMAGE_TABLE_CANDIDATES)
    cur = conn.cursor()
    for tbl, ic, dc in candidates:
        sql = f"SELECT TOP 1 {dc} FROM {tbl} WITH (NOLOCK) WHERE {ic} = ?"
        try:
            cur.execute(sql, (image_id,))
            row = cur.fetchone()
            if not row or row[0] is None:
                continue
            blob = row[0]
            if isinstance(blob, memoryview):
                blob = blob.tobytes()
            elif not isinstance(blob, (bytes, bytearray)):
                blob = bytes(blob)
            if len(blob) < 32:
                continue
            log.info("Loaded script image id=%s from %s (%d bytes)", image_id, tbl, len(blob))
            return bytes(blob)
        except Exception as exc:
            log.debug("Image probe %s failed: %s", tbl, exc)
            continue
    log.info("No script image bytes for id=%s (table missing or empty)", image_id)
    return None


def attach_page_image(row: Dict[str, Any], conn, schema: Dict[str, str]) -> Dict[str, Any]:
    image_id = row.get("ScriptImageId") or row.get("script_image_id")
    raw = fetch_image_bytes(conn, image_id, schema)
    if not raw:
        return row
    url = bytes_to_data_url(raw)
    if not url:
        return row
    out = dict(row)
    out["page_image_data_url"] = url
    out["script_image_id"] = image_id
    return out
