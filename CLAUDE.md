# PharmaFlow - project guide for Claude

Read this first. It exists so you do not need to re-explore the repo. Read only the files/line ranges a task needs.

## What this is
Fax prescription intake for Canadian pharmacies using Kroll (SQL Server, no public API).
Three parts:
1. **`helper/flow.py`** - the ONE server-PC file (Python, ~2500 lines). Polls Kroll SQL, reads fax images, talks to the cloud, learns from staff.
2. **`helper/workstation_helper.py`** - keystroke helper on a workstation (types into Kroll after staff verify). Not used in SHADOW mode.
3. **Web app** - React + Vite + Tailwind + shadcn (`src/`), Vercel serverless functions (`api/`), Supabase (`supabase/migrations`).

## Hard rules
- The agent is **READ-ONLY** on Kroll: SELECT only, `WITH (NOLOCK)`. Never write to Kroll from SQL.
- Modes: `SHADOW` (read and record only, nothing typed into Kroll) vs `LIVE`. Go LIVE only when qty and sig match >= 99.5% on the Live page.
- `helper/config.ini` holds secrets and is gitignored. Never commit it, never paste keys into chat or docs. Template: `helper/config.ini.example`.
- Learned sig fixes auto-apply only if they are wording/note changes (`sig_fix_is_safe`). Dose, number and frequency changes stay hints. Qty/refill/drug differences are recorded, never applied.
- Cloud is multi-tenant: every row is scoped by `store_id`. Never mix stores.
- Another session/person also pushes to `main`. Always `git pull --rebase origin main` before pushing.

## Map of `helper/flow.py` (line numbers drift; use grep)
`AgentConfig` config.ini loader | `LocalStore` shadow_queue.db (SQLite) | `KrollDB` all SQL (fax image path: PendingNewRx.ScriptImageId -> ScriptImage -> ScriptImageContent) |
`CloudClient` HTTP to Vercel | `Learner` learning.db (mode 1: learn from finished Rx in SQL; mode 2: learn from staff corrections) |
`PharmFlowAgent` run loop: `run_once`, `_process_row`, `_early_ocr` (read fax on arrival), `_compare_with_staff`, `_recheck_incomplete` | `main()` CLI.
CLI: `python flow.py` (run), `--test`, `--gen-key`, `--learning-report`, `--shadow-report`, `--discover`, `--schema-report`, `--find-images`, `--profile TABLE`.
The server runs it as the Windows scheduled task "PharmFlow Agent" (SYSTEM, at startup). Only ONE instance may run, a second one double-reports.

## Cloud side
- `api/sync-queue.js` agent -> cloud (header `x-api-key` = env `AGENT_API_KEY`): rows, heartbeat, shadow_result.
- `api/agent-rx.js` fax OCR (Anthropic) merged with SQL fields; applies learned sig mappings (hit_count >= 2).
- `api/live.js` data for the Live page (header `x-access-token` = `APP_ACCESS_TOKEN` or `EXTRACT_ACCESS_TOKEN`).
- `api/learn.js`, `server/learning.js` cloud-side learning. Tests: `pnpm test`.
- Tables: agent_sync_queue, extraction_feedback, learned_mappings (see `supabase/migrations`).
- Deploy = push to `main` (Vercel auto-builds). Env vars live in Vercel; see `.env.example` and `docs/DEPLOY.md`.

## Frontend conventions
- Tailwind only, shadcn primitives in `src/components/ui`, icons from lucide-react, charts from Recharts. See `AI_RULES.md`.
- Visual system = landing page: colours `pf-paper/sheet/ink/slate/rule/amber` (tailwind.config.ts), square corners, 2px ink borders, hard offset shadows.
  Type helpers in `src/index.css`: `.pf-display` (heavy condensed headings/numbers), `.pf-eyebrow` (mono uppercase labels); `font-data` = IBM Plex Mono.
- Success green is `#1F7A4D`; keep green/red for status, never for brand.
- Checks: `npx tsc --noEmit` and `npx vite build` (both must pass).

## Saving tokens when working here
- Do not read `flow.py` whole: grep for the function, read that range.
- Ignore `node_modules`, `dist`, `helper/.venv`, `helper/logs`, `*.db` (see `.claude/settings.json`).
- Code graph: a SessionStart hook in `.claude/settings.json` installs graphifyy if missing and runs `graphify update .` (local, no model cost).
  If `graphify-out/GRAPH_REPORT.md` exists, read it first, then use `graphify explain "Learner"` / `graphify path "A" "B"` instead of grepping broadly.
  If it is missing, run `pip install -q graphifyy && graphify update .` yourself. `graphify-out/` is gitignored. Rebuild after big changes with `graphify update .`.
