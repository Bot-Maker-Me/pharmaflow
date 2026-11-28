-- Mirror Kroll's Inbound Docs "Pending" list: the agent reports which faxes are still unread and not deleted in Kroll.
-- kroll_state: NULL (not reported yet, treated as pending) | 'pending' | 'processed' (gone from Kroll's Pending list).
ALTER TABLE public.inbound_faxes ADD COLUMN IF NOT EXISTS kroll_state TEXT;
CREATE INDEX IF NOT EXISTS idx_inbound_faxes_kroll_state ON public.inbound_faxes (store_id, kroll_state, received_label DESC);
