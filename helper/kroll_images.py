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


def _pdf_first_page(raw: bytes):
    """Kroll sometimes stores the fax as a PDF blob. Needs `pip install pypdfium2` (optional)."""
    try:
        import pypdfium2 as pdfium  # type: ignore
    except ImportError:
        log.warning("Script image is a PDF; install pypdfium2 (pip install pypdfium2) to read it")
        return None
    try:
        pdf = pdfium.PdfDocument(raw)
        return pdf[0].render(scale=2.2).to_pil()
    except Exception as exc:
        log.warning("PDF render failed: %s", exc)
        return None


def _try_pil_jpeg(raw: bytes, max_side: int = 1600, quality: int = 72) -> Optional[bytes]:
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return None
    try:
        if raw[:4] == b"%PDF":
            img = _pdf_first_page(raw)
            if img is None:
                return None
        else:
            img = Image.open(io.BytesIO(raw))  # multi-page TIFF: first page
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


_AUTO: Dict[str, Any] = {"hit": None, "warned": False}
_MAGIC = (b"\xff\xd8\xff", b"\x89PNG", b"II*\x00", b"MM\x00*", b"%PDF", b"GIF8")
_GOOD = ("image", "scan", "script", "fax")
_OK = ("doc", "pic", "attach", "rx")
_BAD = ("sign", "logo", "photo", "audit", "log", "thumb", "icon", "label", "avatar")


def _q(name: str) -> str:
    return "[" + str(name).replace("]", "]]") + "]"


def _score(*names: str) -> int:
    text = " ".join(names).lower()
    return 3 * sum(k in text for k in _GOOD) + sum(k in text for k in _OK) - 4 * sum(k in text for k in _BAD)


def _looks_like_image(blob: bytes) -> bool:
    return len(blob) >= 200 and any(blob.startswith(m) for m in _MAGIC)


def binary_candidates(conn):
    """[(score, table, data_col, [id cols])] for every base table with a binary column, best first."""
    cur = conn.cursor()
    try:
        cur.execute("SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS c "
                    "JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME "
                    "AND t.TABLE_TYPE = 'BASE TABLE' WHERE c.DATA_TYPE IN ('varbinary', 'binary', 'image')")
        bins = cur.fetchall()
        out = []
        for schema, table, col in bins:
            cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
                        "ORDER BY ORDINAL_POSITION", (schema, table))
            cols = [r[0] for r in cur.fetchall()]
            upper = {c.upper(): c for c in cols}
            ids = [upper[k] for k in ("ID", f"{table}ID".upper(), "SCRIPTIMAGEID", "IMAGEID", "DOCUMENTID", "DOCID") if k in upper]
            if cols and cols[0] not in ids:
                ids.append(cols[0])
            out.append((_score(table, col), f"{schema}.{table}", col, ids[:3]))
        out.sort(key=lambda x: (-x[0], x[1]))
        return out
    finally:
        cur.close()


def _probe(conn, table: str, id_col: str, data_col: str, image_id: Any) -> Optional[bytes]:
    schema, _, name = table.partition(".")
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT TOP 1 {_q(data_col)} FROM {_q(schema)}.{_q(name)} WITH (NOLOCK) WHERE {_q(id_col)} = ?", (image_id,))
        row = cur.fetchone()
        if not row or row[0] is None:
            return None
        blob = bytes(row[0].tobytes() if isinstance(row[0], memoryview) else row[0])
        return blob if _looks_like_image(blob) else None
    except Exception:
        return None
    finally:
        cur.close()


def auto_find(conn, image_id: Any):
    """Find the table holding this ScriptImageId. Only returns a result when exactly ONE plausible table
    (name mentions image/scan/script/fax) has it: a wrong guess would attach another patient's image."""
    hits = []
    for score, table, data_col, ids in binary_candidates(conn):
        if score < 3:
            continue
        for id_col in ids:
            blob = _probe(conn, table, id_col, data_col, image_id)
            if blob:
                hits.append((table, id_col, data_col, blob))
                break
    if len(hits) == 1:
        return hits[0]
    if hits and not _AUTO["warned"]:
        _AUTO["warned"] = True
        log.warning("Several tables hold ScriptImageId=%s (%s): set image_table/image_id/image_data in [Schema]. "
                    "Run: python flow.py --find-images", image_id, ", ".join(h[0] for h in hits))
    return None


def find_image_source(conn, image_ids):
    """Diagnostic for `flow.py --find-images`: test real ids against every binary column and report."""
    print("\nBinary columns in this database (best match first):")
    cands = binary_candidates(conn)
    for score, table, col, ids in cands:
        print(f"  score {score:>2}  {table}.{col}   id columns tried: {', '.join(ids)}")
    print()
    found = False
    for image_id in image_ids:
        for score, table, data_col, ids in cands:
            for id_col in ids:
                blob = _probe(conn, table, id_col, data_col, image_id)
                if blob:
                    kind = "JPEG" if blob[:3] == b"\xff\xd8\xff" else "PNG" if blob[:4] == b"\x89PNG" else \
                        "TIFF" if blob[:2] in (b"II", b"MM") else "PDF" if blob[:4] == b"%PDF" else "image"
                    print(f"  ScriptImageId {image_id}: FOUND in {table}  id={id_col}  data={data_col}  ({len(blob):,} bytes, {kind}, score {score})")
                    found = True
                    break
    if found:
        print("\nPut the best match in config.ini under [Schema]:\n  image_table = <table>\n  image_id = <id>\n  image_data = <data>")
    else:
        print("  None of the ids matched an image. The fax may be stored under a different key; send me the list above.")


def fetch_image_bytes(conn, image_id: Any, schema: Dict[str, str]) -> Optional[bytes]:
    if image_id is None or image_id == "" or image_id == 0:
        return None
    table = (schema.get("image_table") or "").strip()
    id_col = (schema.get("image_id") or "Id").strip()
    data_col = (schema.get("image_data") or "ImageData").strip()
    candidates = []
    if table:
        candidates.append((table, id_col, data_col))
    elif _AUTO["hit"]:
        candidates.append(_AUTO["hit"])
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
    if not table and not _AUTO["hit"]:
        found = auto_find(conn, image_id)
        if found:
            _AUTO["hit"] = found[:3]
            log.info("Auto-detected the fax image table: %s (id=%s, data=%s). Put these in [Schema] "
                     "(image_table / image_id / image_data) to make it permanent.", *found[:3])
            return found[3]
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
