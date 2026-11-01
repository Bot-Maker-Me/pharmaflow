-- PharmFlow AI — agent sync queue (run in Supabase SQL editor)
-- Region recommendation: Canada Central if available

-- Incoming payloads from local flow.py agents
CREATE TABLE IF NOT EXISTS public.agent_sync_queue (
  id                BIGSERIAL PRIMARY KEY,
  pending_rx_id     BIGINT,
  pat_id            BIGINT,
  doc_id            BIGINT,
  drug_id           TEXT,
  qty               TEXT,
  refills           TEXT,
  sig_text          TEXT,
  date_created      TIMESTAMPTZ,
  patient_first     TEXT,
  patient_last      TEXT,
  patient_dob       DATE,
  patient_address   TEXT,
  primary_plan_id   TEXT,
  doctor_first      TEXT,
  doctor_last       TEXT,
  doctor_licence    TEXT,
  agent_version     TEXT,
  agent_hostname    TEXT,
  agent_mode        TEXT,
  raw_payload       JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'processing', 'done', 'error')),
  error_message     TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_sync_queue_status
  ON public.agent_sync_queue (status);

CREATE INDEX IF NOT EXISTS idx_agent_sync_queue_pending_rx
  ON public.agent_sync_queue (pending_rx_id);

CREATE INDEX IF NOT EXISTS idx_agent_sync_queue_received
  ON public.agent_sync_queue (received_at DESC);

-- Lightweight telemetry / heartbeat from agents
CREATE TABLE IF NOT EXISTS public.agent_events (
  id            BIGSERIAL PRIMARY KEY,
  hostname      TEXT,
  agent_version TEXT,
  event_type    TEXT NOT NULL,
  message       TEXT,
  meta          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_created
  ON public.agent_events (created_at DESC);

-- RLS: service role only for writes from the Vercel API
ALTER TABLE public.agent_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

-- Allow authenticated dashboard users to read their store data later
-- (tighten with store_id when multi-tenant is added)
CREATE POLICY "service_role_all_sync_queue"
  ON public.agent_sync_queue
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_all_agent_events"
  ON public.agent_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Optional: read access for authenticated users (dashboard)
CREATE POLICY "authenticated_read_sync_queue"
  ON public.agent_sync_queue
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_read_agent_events"
  ON public.agent_events
  FOR SELECT
  TO authenticated
  USING (true);
