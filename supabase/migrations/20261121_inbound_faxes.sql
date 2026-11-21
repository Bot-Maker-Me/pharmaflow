-- PharmaFlow: faxes read from Kroll's "Inbound Docs" (dbo.Mail, MessageType 19) BEFORE staff turn them into a pending Rx.
-- Additive and safe to re-run. Service role only (RLS on, no policies): the agent writes via /api/agent-fax,
-- the Live page reads via /api/live.
CREATE TABLE IF NOT EXISTS public.inbound_faxes (
  id              BIGSERIAL PRIMARY KEY,
  store_id        TEXT NOT NULL DEFAULT 'default',
  mail_id         BIGINT NOT NULL,                 -- Kroll dbo.Mail.Id
  received_label  TEXT,                            -- time as shown by Kroll (server clock)
  from_label      TEXT,                            -- sender / fax number
  doc_type        TEXT,                            -- prescription | refill_request | transfer | other
  is_prescription BOOLEAN NOT NULL DEFAULT FALSE,
  summary         TEXT,
  ocr             JSONB,
  page_image_url  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, mail_id)
);
CREATE INDEX IF NOT EXISTS idx_inbound_faxes_store_created ON public.inbound_faxes (store_id, created_at DESC);
ALTER TABLE public.inbound_faxes ENABLE ROW LEVEL SECURITY;

-- The cloud functions use the service role; tables made through migrations need explicit grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_faxes TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.inbound_faxes_id_seq TO service_role;

-- Workflow: a fax is 'new' until staff push it to Kroll ('pushed') or dismiss it ('dismissed').
-- After a push the agent compares what was pushed with what Kroll finally holds and learns from the difference.
ALTER TABLE public.inbound_faxes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE public.inbound_faxes ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;
ALTER TABLE public.inbound_faxes ADD COLUMN IF NOT EXISTS pushed JSONB;
ALTER TABLE public.inbound_faxes ADD COLUMN IF NOT EXISTS learned_at TIMESTAMPTZ;
ALTER TABLE public.inbound_faxes ADD COLUMN IF NOT EXISTS learn_result JSONB;
CREATE INDEX IF NOT EXISTS idx_inbound_faxes_status ON public.inbound_faxes (store_id, status, created_at DESC);
