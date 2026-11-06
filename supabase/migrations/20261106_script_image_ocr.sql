-- ScriptImage OCR columns on agent_sync_queue
-- Run in Supabase SQL editor if auto-migration is not applied.

alter table public.agent_sync_queue
  add column if not exists page_image_url text,
  add column if not exists ocr_din text,
  add column if not exists ocr_drug_name text,
  add column if not exists ocr_strength text,
  add column if not exists ocr_health_card text;

-- Storage bucket for fax JPEGs (create once in Dashboard > Storage if needed)
-- insert into storage.buckets (id, name, public) values ('rx-images', 'rx-images', true)
--   on conflict (id) do nothing;
