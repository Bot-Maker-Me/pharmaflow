-- PharmFlow multi-tenant isolation + RLS
-- Run in Supabase SQL Editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Organizations (one pharmacy = one org)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  store_id        TEXT NOT NULL UNIQUE,          -- used by flow.py STORE_ID / agent payloads
  plan            TEXT NOT NULL DEFAULT 'trial'
                    CHECK (plan IN ('trial', 'starter', 'pro', 'enterprise')),
  plan_expires_at TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.org_members (
  id           BIGSERIAL PRIMARY KEY,
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'staff'
                 CHECK (role IN ('owner', 'admin', 'staff')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.org_members (user_id);

-- Per-pharmacy secrets (ONLY hashes stored — plaintext shown once at generation)
CREATE TABLE IF NOT EXISTS public.org_api_keys (
  id              BIGSERIAL PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('agent', 'extract')),
  key_prefix      TEXT NOT NULL,                 -- first 8 chars for UI display
  key_hash        TEXT NOT NULL,                 -- sha256 hex of full token
  label           TEXT,
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, kind, key_hash)
);

CREATE INDEX IF NOT EXISTS idx_org_api_keys_hash ON public.org_api_keys (kind, key_hash)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Link existing operational tables to org via store_id (= organizations.store_id)
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_sync_queue
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);

ALTER TABLE public.agent_events
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);

ALTER TABLE public.extraction_feedback
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);

ALTER TABLE public.learned_mappings
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);

-- ---------------------------------------------------------------------------
-- Helper: membership check (security definer, stable)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_org_member(p_org UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = p_org AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.my_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT org_id FROM public.org_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.my_store_ids()
RETURNS SETOF TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.store_id
  FROM public.organizations o
  JOIN public.org_members m ON m.org_id = o.id
  WHERE m.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- RLS: enable + policies (users NEVER get service_role)
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_member ON public.organizations;
CREATE POLICY org_select_member ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_org_ids()));

-- No direct INSERT/UPDATE/DELETE for authenticated on organizations
-- (created via Edge Function / service role signup flow only)

DROP POLICY IF EXISTS members_select_own ON public.org_members;
CREATE POLICY members_select_own ON public.org_members
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.my_org_ids()));

DROP POLICY IF EXISTS api_keys_select_member ON public.org_api_keys;
CREATE POLICY api_keys_select_member ON public.org_api_keys
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.my_org_ids()));

-- Authenticated users can see prefix only conceptually; key_hash is useless without salt alone
-- but we still never expose plaintext. No INSERT/UPDATE of keys for authenticated.

-- agent_sync_queue: isolate by store_id membership
ALTER TABLE public.agent_sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_queue_select_own ON public.agent_sync_queue;
CREATE POLICY sync_queue_select_own ON public.agent_sync_queue
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.my_store_ids()));

-- No INSERT/UPDATE/DELETE for authenticated on sync queue (agent uses service role only)

ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_select_own ON public.agent_events;
CREATE POLICY events_select_own ON public.agent_events
  FOR SELECT TO authenticated
  USING (
    (meta ->> 'store_id') IN (SELECT public.my_store_ids())
    OR org_id IN (SELECT public.my_org_ids())
  );

ALTER TABLE public.extraction_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_select_own ON public.extraction_feedback;
CREATE POLICY feedback_select_own ON public.extraction_feedback
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.my_store_ids()) OR org_id IN (SELECT public.my_org_ids()));

DROP POLICY IF EXISTS feedback_insert_own ON public.extraction_feedback;
CREATE POLICY feedback_insert_own ON public.extraction_feedback
  FOR INSERT TO authenticated
  WITH CHECK (store_id IN (SELECT public.my_store_ids()));

ALTER TABLE public.learned_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mappings_select_own ON public.learned_mappings;
CREATE POLICY mappings_select_own ON public.learned_mappings
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.my_store_ids()) OR org_id IN (SELECT public.my_org_ids()));

-- shadow tables
ALTER TABLE public.shadow_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shadow_reports_select_own ON public.shadow_reports;
CREATE POLICY shadow_reports_select_own ON public.shadow_reports
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.my_store_ids()));

-- Deny anon everything on tenant tables
REVOKE ALL ON public.organizations FROM anon, authenticated;
REVOKE ALL ON public.org_members FROM anon, authenticated;
REVOKE ALL ON public.org_api_keys FROM anon, authenticated;

GRANT SELECT ON public.organizations TO authenticated;
GRANT SELECT ON public.org_members TO authenticated;
GRANT SELECT ON public.org_api_keys TO authenticated;

GRANT SELECT ON public.agent_sync_queue TO authenticated;
GRANT SELECT ON public.agent_events TO authenticated;
GRANT SELECT, INSERT ON public.extraction_feedback TO authenticated;
GRANT SELECT ON public.learned_mappings TO authenticated;
GRANT SELECT ON public.shadow_reports TO authenticated;

-- service_role keeps full access (Vercel APIs only)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

COMMENT ON TABLE public.organizations IS 'One row per pharmacy customer. Data isolation boundary.';
COMMENT ON TABLE public.org_api_keys IS 'Hashed per-pharmacy agent/extract tokens. Plaintext never stored.';
