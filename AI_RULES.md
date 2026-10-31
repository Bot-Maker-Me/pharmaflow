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

## Do Not
- Do not edit files inside `src/components/ui/` (the shadcn library files). Create a new wrapper component instead if customization is needed.
- Do not introduce a new dependency for something an installed library already covers.
- Do not use CSS modules, styled-components, or inline `<style>` blocks.
- Do not add a second router or a second component library.
