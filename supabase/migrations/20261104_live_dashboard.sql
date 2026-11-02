-- PharmFlow: live dashboard support + "shadow week start" marker. Safe to re-run.

-- Rows received before live_since are "backlog" (e.g. the first catch-up of old pending rows):
-- they stay visible in the live feed but are excluded from rates and nightly reports.
INSERT INTO public.shadow_report_settings (key, value) VALUES ('live_since', now()::text)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.generate_shadow_report(
  p_store TEXT, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_date DATE DEFAULT CURRENT_DATE
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_seen INT; v_auto INT; v_exc INT;
  v_cmp INT; v_waiting INT; v_never INT;
  v_fields JSONB; v_reasons JSONB; v_summary JSONB;
  v_heartbeats INT; v_last_hb TIMESTAMPTZ;
  v_body TEXT; v_line TEXT; v_id BIGINT; v_worst NUMERIC := 1; v_since TIMESTAMPTZ;
BEGIN
  SELECT NULLIF(value, '')::timestamptz INTO v_since FROM shadow_report_settings WHERE key = 'live_since';
  IF v_since IS NOT NULL AND p_start < v_since THEN p_start := v_since; END IF;

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

CREATE OR REPLACE FUNCTION public.live_stats(p_store TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_since TIMESTAMPTZ; v_start TIMESTAMPTZ;
  r JSONB; v_fields JSONB; v_reasons JSONB; v_per_min JSONB; v_hb JSONB;
BEGIN
  SELECT NULLIF(value, '')::timestamptz INTO v_since FROM shadow_report_settings WHERE key = 'live_since';
  v_start := COALESCE(v_since, now() - interval '7 days');

  SELECT jsonb_build_object(
    'server_time', now(), 'live_since', v_since,
    'total_rows',   count(*),
    'backlog_rows', count(*) FILTER (WHERE received_at < v_start),
    'since_start',  count(*) FILTER (WHERE received_at >= v_start),
    'auto',         count(*) FILTER (WHERE received_at >= v_start AND decision = 'AUTO'),
    'exception',    count(*) FILTER (WHERE received_at >= v_start AND decision = 'EXCEPTION'),
    'compared',     count(*) FILTER (WHERE received_at >= v_start AND decision = 'AUTO' AND actual IS NOT NULL),
    'waiting',      count(*) FILTER (WHERE received_at >= v_start AND decision = 'AUTO' AND compared_at IS NULL),
    'never_entered',count(*) FILTER (WHERE received_at >= v_start AND decision = 'AUTO' AND compared_at IS NOT NULL AND actual IS NULL),
    'last_minute',  count(*) FILTER (WHERE received_at > now() - interval '1 minute'),
    'last_hour',    count(*) FILTER (WHERE received_at > now() - interval '1 hour'),
    'last_received', max(received_at)
  ) INTO r FROM agent_sync_queue WHERE p_store IS NULL OR store_id = p_store;

  SELECT COALESCE(jsonb_object_agg(f, jsonb_build_object('match', m, 'total', t)), '{}'::jsonb) INTO v_fields
    FROM (SELECT k AS f, count(*) FILTER (WHERE (field_match ->> k)::boolean) AS m, count(*) AS t
            FROM agent_sync_queue, LATERAL jsonb_object_keys(field_match) k
           WHERE (p_store IS NULL OR store_id = p_store) AND received_at >= v_start
             AND decision = 'AUTO' AND actual IS NOT NULL AND field_match IS NOT NULL
           GROUP BY k) x;

  SELECT COALESCE(jsonb_object_agg(reason, n), '{}'::jsonb) INTO v_reasons
    FROM (SELECT x AS reason, count(*) AS n
            FROM agent_sync_queue, LATERAL jsonb_array_elements_text(decision_issues) x
           WHERE (p_store IS NULL OR store_id = p_store) AND received_at >= v_start AND decision = 'EXCEPTION'
           GROUP BY x) y;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('t', m.minute, 'n', m.n) ORDER BY m.minute), '[]'::jsonb) INTO v_per_min
    FROM (SELECT gs AS minute, count(q.id) AS n
            FROM generate_series(date_trunc('minute', now()) - interval '29 minutes', date_trunc('minute', now()), interval '1 minute') gs
            LEFT JOIN agent_sync_queue q
              ON q.received_at >= gs AND q.received_at < gs + interval '1 minute' AND (p_store IS NULL OR q.store_id = p_store)
           GROUP BY gs) m;

  SELECT jsonb_build_object('last_seen', created_at, 'store_id', meta ->> 'store_id', 'mode', meta ->> 'mode', 'host', hostname)
    INTO v_hb FROM agent_events WHERE event_type = 'heartbeat' ORDER BY created_at DESC LIMIT 1;

  RETURN r || jsonb_build_object('fields', v_fields, 'reasons', v_reasons, 'per_minute', v_per_min, 'heartbeat', COALESCE(v_hb, 'null'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.live_stats(TEXT) FROM PUBLIC, anon, authenticated;
