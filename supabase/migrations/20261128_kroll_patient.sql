-- The agent looks up the real Kroll patient for each new fax by date of birth + best name fit (the name on a fax is often misspelt).
ALTER TABLE public.inbound_faxes ADD COLUMN IF NOT EXISTS kroll_patient JSONB;
