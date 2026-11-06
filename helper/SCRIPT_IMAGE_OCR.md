# Full auto: ScriptImageId + OCR + SQL

## What runs

1. `flow.py` reads `PendingNewRx` including `ScriptImageId`
2. `kroll_images.py` loads the binary from `RxScriptImage` / `ScriptImage` (or config override)
3. JPEG is compressed and posted to `/api/agent-rx` with the SQL fields
4. Cloud runs Anthropic vision OCR, merges DIN / strength / health card with SQL
5. Image stored in Supabase `rx-images` bucket; row updated with `page_image_url` + OCR columns
6. Inbox **Load into Verify** shows real fax image + filled fields side by side

## PC setup

```bat
cd C:\PharmFlow\helper
.\venv\Scripts\activate
pip install Pillow
```

Copy `kroll_images.py` next to `flow_body.py`. Update `flow_body.py` from the repo (or re-download `pharmflow_flow_body.py`).

Optional in `config.ini` `[Schema]`:

```ini
pending_script_image_id = ScriptImageId
image_table = dbo.RxScriptImage
image_id = Id
image_data = ImageData
```

Discover real table:

```bat
sqlcmd -S localhost -U rx -P YOURPASS -d Pharmacy -Q "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME LIKE '%Image%' OR DATA_TYPE IN ('varbinary','image') ORDER BY 1,2,3"
```

## Cloud

- `AGENT_API_KEY`, `ANTHROPIC_API_KEY`, Supabase service role
- Run `supabase/migrations/20261106_script_image_ocr.sql`
- Create public storage bucket `rx-images` if upload fails

## Note

Rows with `ScriptImageId = NULL` still sync SQL only (no OCR image). Staff can still complete DIN in Verify.
