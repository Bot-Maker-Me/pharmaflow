-- What Kroll knows about each fax: doctor (licence / name), drug products (DIN candidates), the patient's last Rx, safe gap-fills.
ALTER TABLE public.inbound_faxes ADD COLUMN IF NOT EXISTS kroll_enrich JSONB;
