-- PharmFlow: learn from technician corrections on the verification screen.
-- Safe to re-run.

-- One row per field the tech changed before Verify / Push.
CREATE TABLE IF NOT EXISTS public.extraction_feedback (
  id              BIGSERIAL PRIMARY KEY,
  store_id        TEXT NOT NULL DEFAULT 'default',
  script_id       TEXT,
  document_name   TEXT,
  field_path      TEXT NOT NULL,          -- e.g. patient.health_card_num, medications[0].din
  original_value  TEXT,
  corrected_value TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- surrounding fields (no full PHI dump required)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extraction_feedback_store_created
  ON public.extraction_feedback (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_extraction_feedback_field
  ON public.extraction_feedback (field_path, created_at DESC);

ALTER TABLE public.extraction_feedback ENABLE ROW LEVEL SECURITY;

-- Aggregated, reusable mappings (DIN -> drug/strength, OCR typos, etc.)
CREATE TABLE IF NOT EXISTS public.learned_mappings (
  id              BIGSERIAL PRIMARY KEY,
  store_id        TEXT NOT NULL DEFAULT 'default',
  kind            TEXT NOT NULL,          -- din_to_drug | din_to_strength | text_replace | health_card_format
  source_key      TEXT NOT NULL,          -- e.g. DIN digits, or original OCR string
  target_value    TEXT NOT NULL,
  hit_count       INT NOT NULL DEFAULT 1,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, kind, source_key)
);

CREATE INDEX IF NOT EXISTS idx_learned_mappings_lookup
  ON public.learned_mappings (store_id, kind, source_key);

ALTER TABLE public.learned_mappings ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.extraction_feedback TO service_role;
GRANT ALL ON TABLE public.learned_mappings TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
