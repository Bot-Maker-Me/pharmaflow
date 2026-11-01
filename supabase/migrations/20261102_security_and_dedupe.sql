-- Run this if you ALREADY applied 20261101_agent_sync_queue.sql (safe to re-run).

-- 1) Close the PHI leak: remove the policies that let any authenticated user read everything.
DROP POLICY IF EXISTS "authenticated_read_sync_queue" ON public.agent_sync_queue;
DROP POLICY IF EXISTS "authenticated_read_agent_events" ON public.agent_events;

-- 2) Remove duplicate rows (keep the oldest), then enforce idempotent inserts.
DELETE FROM public.agent_sync_queue a
USING public.agent_sync_queue b
WHERE a.pending_rx_id = b.pending_rx_id
  AND a.agent_hostname IS NOT DISTINCT FROM b.agent_hostname
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_sync_queue_rx_host
  ON public.agent_sync_queue (pending_rx_id, agent_hostname);
