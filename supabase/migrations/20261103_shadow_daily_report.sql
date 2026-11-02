-- PharmFlow: shadow-week data in Supabase + automatic daily comparison report.
-- Safe to re-run.

-- 1) What the agent decided / what staff actually entered, per prescription
ALTER TABLE public.agent_sync_queue
  ADD COLUMN IF NOT EXISTS decision        TEXT CHECK (decision IN ('AUTO', 'EXCEPTION')),
  ADD COLUMN IF NOT EXISTS decision_issues JSONB,
  ADD COLUMN IF NOT EXISTS planned         JSONB,
  ADD COLUMN IF NOT EXISTS actual          JSONB,
  ADD COLUMN IF NOT EXISTS field_match     JSONB,
  ADD COLUMN IF NOT EXISTS compared_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_sync_queue_store_received
  ON public.agent_sync_queue (store_id, received_at DESC);

-- 2) Settings (service role / postgres only: RLS on, no policies)
CREATE TABLE IF NOT EXISTS public.shadow_report_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.shadow_report_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.shadow_report_settings (key, value) VALUES
  ('timezone',       'America/Toronto'),  -- pharmacy local time zone (IANA name)
  ('send_hour',      '20'),               -- local hour (0-23) the report is produced: 20 = 8 PM
  ('webhook_url',    ''),                 -- https://<app>/api/daily-report  (sends the e-mail)
  ('webhook_secret', ''),                 -- same value as Vercel env REPORT_SECRET
  ('bypass_token',   '')                  -- Vercel Deployment Protection bypass token, if used
ON CONFLICT (key) DO NOTHING;

-- 3) Stored reports
CREATE TABLE IF NOT EXISTS public.shadow_reports (
  id           BIGSERIAL PRIMARY KEY,
  store_id     TEXT NOT NULL,
  report_date  DATE NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,
  summary      JSONB NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  emailed_at   TIMESTAMPTZ,
  UNIQUE (store_id, report_date)
);
ALTER TABLE public.shadow_reports ENABLE ROW LEVEL SECURITY;

-- 4) Report generator
CREATE OR REPLACE FUNCTION public.generate_shadow_report(
  p_store TEXT, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_date DATE DEFAULT CURRENT_DATE
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_seen INT; v_auto INT; v_exc INT;
  v_cmp INT; v_waiting INT; v_never INT;
  v_fields JSONB; v_reasons JSONB; v_summary JSONB;
  v_heartbeats INT; v_last_hb TIMESTAMPTZ;
  v_body TEXT; v_line TEXT; v_id BIGINT; v_worst NUMERIC := 1;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE decision = 'AUTO'), count(*) FILTER (WHERE decision = 'EXCEPTION'),
         count(*) FILTER (WHERE decision = 'AUTO' AND actual IS NOT NULL),
         count(*) FILTER (WHERE decision = 'AUTO' AND compared_at IS NULL),
         count(*) FILTER (WHERE decision = 'AUTO' AND compared_at IS NOT NULL AND actual IS NULL)
    INTO v_seen, v_auto, v_exc, v_cmp, v_waiting, v_never
    FROM agent_sync_queue
   WHERE store_id = p_store AND received_at >= p_start AND received_at < p_end AND decision IS NOT NULL;

  SELECT COALESCE(jsonb_object_agg(f, jsonb_build_object('match', m, 'total', t)), '{}'::jsonb)
    INTO v_fields
    FROM (SELECT k AS f,
                 count(*) FILTER (WHERE (field_match ->> k)::boolean) AS m,
                 count(*) AS t
            FROM agent_sync_queue, LATERAL jsonb_object_keys(field_match) k
           WHERE store_id = p_store AND received_at >= p_start AND received_at < p_end
             AND decision = 'AUTO' AND actual IS NOT NULL AND field_match IS NOT NULL
           GROUP BY k) x;

  SELECT COALESCE(jsonb_object_agg(reason, n), '{}'::jsonb)
    INTO v_reasons
    FROM (SELECT r AS reason, count(*) AS n
            FROM agent_sync_queue, LATERAL jsonb_array_elements_text(decision_issues) r
           WHERE store_id = p_store AND received_at >= p_start AND received_at < p_end
             AND decision = 'EXCEPTION'
           GROUP BY r) x;

  SELECT count(*), max(created_at) INTO v_heartbeats, v_last_hb
    FROM agent_events
   WHERE event_type = 'heartbeat' AND meta ->> 'store_id' = p_store
     AND created_at >= p_start AND created_at < p_end;
  IF v_last_hb IS NULL THEN
    SELECT max(created_at) INTO v_last_hb FROM agent_events
     WHERE event_type = 'heartbeat' AND meta ->> 'store_id' = p_store;
  END IF;

  v_body := format(E'PharmFlow shadow report - store "%s" - %s\nPeriod: %s to %s (UTC)\n\n',
                   p_store, p_date, to_char(p_start, 'YYYY-MM-DD HH24:MI'), to_char(p_end, 'YYYY-MM-DD HH24:MI'))
         || format(E'Prescriptions seen by the agent : %s\n  would be AUTOMATIC          : %s (%s)\n  would go to a person        : %s\n',
                   v_seen, v_auto, CASE WHEN v_seen > 0 THEN to_char(100.0 * v_auto / v_seen, 'FM990.0') || '%' ELSE 'n/a' END, v_exc);

  FOR v_line IN SELECT format('      - %s: %s', key, value) FROM jsonb_each_text(v_reasons) ORDER BY value::int DESC LOOP
    v_body := v_body || v_line || E'\n';
  END LOOP;

  v_body := v_body || format(E'\nStaff entries compared (AUTO decisions) : %s\n  still waiting for staff to enter it    : %s\n  never entered in Kroll (gave up)       : %s\n\nField match rate (agent vs staff):\n',
                             v_cmp, v_waiting, v_never);
  FOR v_line IN
    SELECT format('  %-9s %s  (%s/%s)', key,
                  CASE WHEN (value ->> 'total')::int > 0 THEN to_char(100.0 * (value ->> 'match')::int / (value ->> 'total')::int, 'FM990.00') || '%' ELSE 'n/a' END,
                  value ->> 'match', value ->> 'total')
      FROM jsonb_each(v_fields) ORDER BY key
  LOOP
    v_body := v_body || v_line || E'\n';
  END LOOP;
  IF v_fields = '{}'::jsonb THEN
    v_body := v_body || E'  (nothing compared yet - check [RxSchema] in config.ini)\n';
  END IF;

  v_body := v_body || E'\nMismatches (Kroll Rx ids and fields only, no names):\n';
  FOR v_line IN
    SELECT format('  PendingRxId=%s differs in: %s', pending_rx_id,
                  (SELECT string_agg(e.key, ', ') FROM jsonb_each_text(field_match) e WHERE e.value = 'false'))
      FROM agent_sync_queue
     WHERE store_id = p_store AND received_at >= p_start AND received_at < p_end
       AND decision = 'AUTO' AND field_match IS NOT NULL
       AND EXISTS (SELECT 1 FROM jsonb_each_text(field_match) e WHERE e.value = 'false')
     ORDER BY received_at DESC LIMIT 15
  LOOP
    v_body := v_body || v_line || E'\n';
    v_worst := 0;
  END LOOP;
  IF v_worst = 1 THEN v_body := v_body || E'  none\n'; END IF;

  v_body := v_body || format(E'\nAgent health: %s heartbeat(s) this period (about 288 expected per day), last seen %s UTC.\n',
                             v_heartbeats, COALESCE(to_char(v_last_hb, 'YYYY-MM-DD HH24:MI'), 'NEVER'));
  IF v_last_hb IS NULL OR v_last_hb < p_end - interval '30 minutes' THEN
    v_body := v_body || E'WARNING: the agent has not reported in the last 30 minutes - check the server PC.\n';
  END IF;

  v_summary := jsonb_build_object('seen', v_seen, 'auto', v_auto, 'exception', v_exc, 'compared', v_cmp,
                                  'waiting', v_waiting, 'never_entered', v_never, 'fields', v_fields,
                                  'reasons', v_reasons, 'heartbeats', v_heartbeats, 'last_heartbeat', v_last_hb);

  INSERT INTO shadow_reports (store_id, report_date, period_start, period_end, summary, body)
  VALUES (p_store, p_date, p_start, p_end, v_summary, v_body)
  ON CONFLICT (store_id, report_date)
  DO UPDATE SET period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
                summary = EXCLUDED.summary, body = EXCLUDED.body, created_at = NOW(), emailed_at = NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 5) Scheduled entry point: runs hourly, acts only in the configured local hour
CREATE OR REPLACE FUNCTION public.run_daily_shadow_report() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tz TEXT; v_hour INT; v_local TIMESTAMP; r RECORD; v_id BIGINT;
  v_url TEXT; v_secret TEXT; v_bypass TEXT; v_headers JSONB;
BEGIN
  SELECT value INTO v_tz     FROM shadow_report_settings WHERE key = 'timezone';
  SELECT value::int INTO v_hour FROM shadow_report_settings WHERE key = 'send_hour';
  SELECT value INTO v_url    FROM shadow_report_settings WHERE key = 'webhook_url';
  SELECT value INTO v_secret FROM shadow_report_settings WHERE key = 'webhook_secret';
  SELECT value INTO v_bypass FROM shadow_report_settings WHERE key = 'bypass_token';

  v_local := now() AT TIME ZONE COALESCE(v_tz, 'America/Toronto');
  IF extract(hour FROM v_local)::int <> COALESCE(v_hour, 20) THEN RETURN; END IF;

  FOR r IN SELECT DISTINCT store_id FROM agent_sync_queue WHERE received_at > now() - interval '3 days' LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM shadow_reports WHERE store_id = r.store_id AND report_date = v_local::date);

    v_id := generate_shadow_report(r.store_id, now() - interval '24 hours', now(), v_local::date);

    IF COALESCE(v_url, '') <> '' THEN
      BEGIN
        v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-report-secret', COALESCE(v_secret, ''));
        IF COALESCE(v_bypass, '') <> '' THEN
          v_headers := v_headers || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
        END IF;
        PERFORM net.http_post(url := v_url, headers := v_headers, body := jsonb_build_object('report_id', v_id));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'shadow report webhook failed: %', SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.generate_shadow_report(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_daily_shadow_report() FROM PUBLIC, anon, authenticated;

-- 6) Schedule (pg_cron runs in UTC, so it fires hourly and the function checks the local hour: DST-safe)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  PERFORM cron.unschedule('pharmaflow-shadow-report')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pharmaflow-shadow-report');
  PERFORM cron.schedule('pharmaflow-shadow-report', '0 * * * *', 'select public.run_daily_shadow_report()');
END $$;
