-- ScriptImage OCR columns on agent_sync_queue
-- Run in Supabase SQL editor if auto-migration is not applied.

alter table public.agent_sync_queue
  add column if not exists page_image_url text,
  add column if not exists ocr_din text,
  add column if not exists ocr_drug_name text,
  add column if not exists ocr_strength text,
  add column if not exists ocr_health_card text;

-- Private storage bucket for fax JPEGs (patient data: never public).
-- The API stores the object path and /api/queue hands out 1-hour signed links.
insert into storage.buckets (id, name, public)
values ('rx-images', 'rx-images', false)
on conflict (id) do update set public = false;
