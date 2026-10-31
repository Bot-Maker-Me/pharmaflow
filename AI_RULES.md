# AI_RULES.md

## Tech Stack
- **React** (with TypeScript) for all UI code.
- **Vite** as the build tool and dev server.
- **TypeScript** everywhere — strongly typed props, state, and API data. Avoid `any`.
- **React Router** for client-side routing. Keep all route definitions in `src/App.tsx`.
- **Tailwind CSS** for all styling — no separate CSS files or inline style objects (except for dynamic values Tailwind can't express).
- **shadcn/ui** as the primary component library (built on **Radix UI** primitives).
- **lucide-react** for all icons.
- **Recharts** for charts and data visualization.
- **react-hook-form** + **zod** for forms and validation.
- **clsx** / **tailwind-merge** (via the `cn` helper) for conditional class names.

## Project Structure
- All source code lives in `src/`.
- Pages go in `src/pages/` and components go in `src/components/`.
- The default/main page is `src/pages/Index.tsx`.
- Keep files small and focused; one component per file is preferred.
- Always update `src/pages/Index.tsx` (or the relevant route) so new components are actually rendered.

## Library Rules — What to Use for What
- **Layout & structure**: Tailwind utility classes and plain semantic HTML (`div`, `section`, `main`, `header`).
- **Buttons, inputs, dialogs, menus, tabs, tooltips, sheets, dropdowns, etc.**: use prebuilt **shadcn/ui** components. Do NOT hand-roll these or pull in another UI kit.
- **Icons**: use **lucide-react** only. Do not mix in other icon sets or inline SVGs unless a specific icon is missing.
- **Styling**: use **Tailwind CSS** exclusively. Compose conditional classes with the `cn()` helper (`clsx` + `tailwind-merge`).
- **Routing**: use **React Router** (`react-router-dom`). Keep route definitions centralized in `src/App.tsx`.
- **Forms**: use **react-hook-form** for form state and **zod** for schema validation; wire zod in via `@hookform/resolvers`.
- **Data fetching / server state**: use plain `fetch` inside `useEffect` for simple cases, or React Query (`@tanstack/react-query`) for caching-heavy needs. Do not add Axios unless explicitly required.
- **Global state**: prefer React's built-in `useState` / `useContext` / `useReducer`. Only reach for a state library (e.g. Zustand) if state clearly outgrows context.
- **Charts**: use **Recharts**.
- **Notifications / toasts**: use the shadcn `sonner` (toast) component.
- **Dates**: use the native `Date` API or `date-fns` if formatting gets complex.
- **Tables**: build with Tailwind + shadcn `Table` components; use `@tanstack/react-table` only for complex sorting/filtering.

## PharmFlow App Architecture
- Feature: **PharmFlow AI** — Vision AI prescription intake + keystroke automation for Canadian pharmacies.
- `src/lib/types.ts` is the shared domain model (Script, Medication, ProcessedDocument, Settings). Extend it first when adding data.
- `src/services/` holds all I/O and integrations:
  - `vision.ts` — extraction client. `demo` mode uses the offline generator; `live` mode POSTs to `{apiBaseUrl}/api/extract`.
  - `mockVision.ts` — deterministic sample-data generator that also renders the fax pages as SVGs and emits the field bounding boxes.
  - `dpd.ts` — Health Canada DIN check digit + Drug Product Database cross-reference.
  - `agent.ts` — `LocalHelperClient`: probes `GET {helperUrl}/health` and pushes with `POST {helperUrl}/autofill`; degrades to a simulated keystroke run when the helper is absent.
  - `pdf.ts` — pdf.js loading/rendering for uploaded multi-page faxes.
- `src/lib/payload.ts` builds the keystroke payload contract (`{ target_system, data: { patient_lookup, prescriber_license, din_code, quantity, sig_text } }`), one request per medication. `src/lib/sig.ts` converts plain-English directions into PMS Latin abbreviations.
- `helper/kroll_tray_helper.py` is the companion Flask helper (PyInstaller-ready) that replays the payload as keystrokes. Keep its contract in sync with `src/lib/payload.ts`.
- `src/lib/pms.ts` defines the supported PMS profiles (target system, key map, hotkey) and the keystroke trace plan.
- `src/store/app-store.tsx` is the single source of truth for queue state, settings (persisted to localStorage), theme and helper status. Reach it with the `useAppStore()` hook.
- Confidence colour coding lives in `src/lib/confidence.ts` (green > high, amber for medium / unverified DIN / missing licence, red for low or illegible). Every level style needs `dark:` variants.
- Theming is class-based (`dark` on `<html>`), driven by `settings.theme`; palette is slate surfaces with indigo accents.

## Do Not
- Do not edit files inside `src/components/ui/` (the shadcn library files). Create a new wrapper component instead if customization is needed.
- Do not introduce a new dependency for something an installed library already covers.
- Do not use CSS modules, styled-components, or inline `<style>` blocks.
- Do not add a second router or a second component library.
