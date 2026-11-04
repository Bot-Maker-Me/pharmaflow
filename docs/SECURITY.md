# Pharma Flow — Security & multi-tenant model

## Isolation rule

**One pharmacy = one `organizations` row = one `store_id`.**

- Agent payloads, verification learnings, and shadow reports are scoped by `store_id` / `org_id`.
- Pharmacy A never reads Pharmacy B rows, even for the same DIN or drug name.
- Learning mappings are **per store**, not global.

## Auth

- End users sign in with **Supabase Auth** (email/password).
- Browser uses the **anon** key only.
- **Row Level Security (RLS)** restricts every tenant table to `my_org_ids()` / `my_store_ids()`.
- Users **cannot** escalate `plan` or membership via the client: those columns are not updatable by `authenticated`.

## API tokens (per pharmacy)

| Token | Used by | Storage |
|-------|---------|---------|
| Agent key | `flow.py` → `/api/sync-queue` | **SHA-256 hash** in `org_api_keys` |
| Extract token | Browser → `/api/extract` | **SHA-256 hash** in `org_api_keys` |

- Plaintext is shown **once** when generated, then only the hash is kept.
- Global `AGENT_API_KEY` / `EXTRACT_ACCESS_TOKEN` env vars are a **bootstrap** for single-tenant installs; multi-tenant production should verify against `org_api_keys`.

## What clients cannot do

- No direct SQL against your project without Auth + RLS.
- No `service_role` key in the browser (never ship it in `VITE_*`).
- No INSERT/UPDATE on `agent_sync_queue` from the browser.
- No changing own `plan` to unlimited via Table Editor as a normal user (Table Editor as project owner is a different trust boundary — protect the Supabase dashboard).

## Uploads / malware

- Fax images are processed in memory on the extract path; reject non-image data URLs and size-cap pages (`api/extract.js`).
- Do not accept arbitrary file uploads into Postgres.
- Prefer Supabase Storage with MIME allow-list and virus scanning if you later store faxes at rest.

## Caching

- Browser: learned mappings in `localStorage` (store-scoped keys recommended).
- API: short `Cache-Control: no-store` on PHI endpoints.
- Optional: CDN cache only for public marketing pages, never for `/api/*` PHI.

## Kroll / on-prem data

- The Windows agent uses a **read-only** SQL user.
- Prefer SHADOW until match rates are proven.
- Minimize cloud fields: IDs + structured Rx fields; avoid free-text notes with extra PHI when possible.
- TLS to Vercel only (`https://` API URL required in agent config).

## Operator checklist

1. Run migrations including `20261105_multi_tenant_security.sql`.
2. Enable Supabase Auth email provider.
3. Set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` on Vercel (anon only).
4. Keep `SUPABASE_SERVICE_ROLE_KEY` **server-only** (Vercel env, not Vite).
5. Rotate any token that was committed to chat, git, or screenshots.
6. Lock Supabase dashboard to owners only; use MFA.

## Honest limits

No system is unhackable. This design reduces blast radius: stolen browser sessions affect one org; stolen service role is catastrophic — protect it like a root password.
