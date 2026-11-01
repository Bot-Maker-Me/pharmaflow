-- Safe to re-run. Brings an existing database in line with the repo.

-- 1) Close the PHI leak: remove policies that let any authenticated user read everything.
DROP POLICY IF EXISTS "authenticated_read_sync_queue" ON public.agent_sync_queue;
DROP POLICY IF EXISTS "authenticated_read_agent_events" ON public.agent_events;

-- 2) Multi-pharmacy / multi-PC de-duplication key.
ALTER TABLE public.agent_sync_queue
  ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT 'default';

DROP INDEX IF EXISTS public.uq_agent_sync_queue_rx_host;

DELETE FROM public.agent_sync_queue a
USING public.agent_sync_queue b
WHERE a.store_id = b.store_id
  AND a.pending_rx_id = b.pending_rx_id
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_sync_queue_store_rx
  ON public.agent_sync_queue (store_id, pending_rx_id);
