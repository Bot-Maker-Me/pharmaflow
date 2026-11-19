-- PharmFlow: closed learning loop (fax scan -> staff/Kroll -> corrections -> next scan).
-- Additive and safe to re-run.

-- 1) Where a correction came from + which Kroll pending Rx it belongs to.
ALTER TABLE public.extraction_feedback ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'verify_ui';
ALTER TABLE public.extraction_feedback ADD COLUMN IF NOT EXISTS pending_rx_id BIGINT;

-- One feedback row per (store, source, pending Rx, field): when staff edit the Rx in Kroll again
-- later, the agent's re-report UPDATES the row instead of piling up duplicates.
-- NULL pending_rx_id (verify-screen rows) never conflict, so those keep inserting normally.
CREATE UNIQUE INDEX IF NOT EXISTS uq_extraction_feedback_kroll
  ON public.extraction_feedback (store_id, source, pending_rx_id, field_path);

-- 2) Atomic hit counter. The old upsert reset hit_count to 1 on every conflict, so a mapping could
--    never be confirmed more than twice. Same target -> +1. Different target -> latest wins, count restarts.
CREATE OR REPLACE FUNCTION public.bump_learned_mapping(
  p_store_id TEXT, p_kind TEXT, p_source_key TEXT, p_target_value TEXT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_hits INT;
BEGIN
  INSERT INTO learned_mappings (store_id, kind, source_key, target_value, hit_count, last_seen_at)
  VALUES (p_store_id, p_kind, p_source_key, p_target_value, 1, now())
  ON CONFLICT (store_id, kind, source_key) DO UPDATE
    SET hit_count    = CASE WHEN learned_mappings.target_value = EXCLUDED.target_value
                            THEN learned_mappings.hit_count + 1 ELSE 1 END,
        target_value = EXCLUDED.target_value,
        last_seen_at = now()
  RETURNING hit_count INTO v_hits;
  RETURN v_hits;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_learned_mapping(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_learned_mapping(TEXT, TEXT, TEXT, TEXT) TO service_role;
