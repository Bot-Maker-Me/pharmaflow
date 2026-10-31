# PharmFlow AI — Architecture

## 1. Core Tech Stack
- **Frontend:** React 18 + TypeScript, Vite 5, React Router 6, Tailwind CSS, shadcn/ui (Radix), lucide-react, Recharts, react-hook-form + zod.
- **Backend:** none in-repo — the SPA is a static bundle calling two services:
  - Vision extraction API (`POST {apiBaseUrl}/api/extract`) — Claude 3.5 Sonnet / GPT-4o Vision.
  - Flask desktop helper (`helper/kroll_tray_helper.py`) on `127.0.0.1:48120` — `/health`, `/autofill`.
- **Database:** none. Queue state is in-memory (`src/store/app-store.tsx`); settings persist to `localStorage`; DIN checks use an offline Health Canada DPD subset (`src/services/dpd.ts`).
- **Hosting:** static/CDN for the SPA; the helper ships as a PyInstaller `.exe` per pharmacy workstation.

## 2. Code Structure & Modules
- `src/pages/` — routed screens (Intake, Verify, Queue, Settings); routes in `src/App.tsx`.
- `src/components/` — app widgets; `src/components/ui/` is vendored shadcn (do not edit).
- `src/services/` — all I/O: `vision.ts`, `agent.ts` (helper bridge), `dpd.ts`, `pdf.ts`, `mockVision.ts`.
- `src/lib/` — domain types, confidence rules, PMS profiles, sig translation, payload contract.
- `src/store/`, `src/hooks/` — shared state and reusable hooks.

## 3. Coding Conventions & Security
- TypeScript strict; type props, state and API data; never `any`.
- Tailwind + `cn()` only; every colour style needs `dark:` variants.
- Reuse shadcn/ui and lucide-react — no duplicate UI or icon libraries.
- Extend `src/lib/types.ts` before adding data shapes.
- Keep `src/lib/payload.ts` and the helper's contract in sync.
- No secrets in the SPA; API keys live server-side.
- Helper binds loopback only and rejects unknown `target_system` values.
- Escape untrusted text; no `dangerouslySetInnerHTML`.
- Never log or persist PHI.
