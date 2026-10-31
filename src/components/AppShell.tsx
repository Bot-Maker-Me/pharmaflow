import { Activity, Home, ListChecks, Pill, Settings2, ShieldCheck } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { HelperStatus } from "@/components/HelperStatus";
import { QuickActions } from "@/components/QuickActions";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Intake", icon: Home, end: true },
  { to: "/app/verify", label: "Verification", icon: ShieldCheck, end: false },
  { to: "/app/queue", label: "Queue", icon: ListChecks, end: false },
  { to: "/app/settings", label: "Settings", icon: Settings2, end: false },
];

function titleFor(pathname: string): { title: string; subtitle: string } {
  if (pathname.includes("/verify"))
    return { title: "Verification workspace", subtitle: "Side-by-side document review and data entry" };
  if (pathname.includes("/queue"))
    return { title: "Prescription queue", subtitle: "Every script captured from the intake pipeline" };
  if (pathname.includes("/settings"))
    return { title: "Settings", subtitle: "Extraction, DIN verification and the local desktop helper" };
  return { title: "Prescription intake", subtitle: "Vision AI ingestion of faxed prescriptions" };
}

export function AppShell() {
  const { stats } = useAppStore();
  const location = useLocation();
  const { title, subtitle } = titleFor(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-16 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:w-60">
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-3 lg:px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent/20 text-sidebar-accent ring-1 ring-sidebar-accent/40">
            <Pill className="h-5 w-5" />
          </span>
          <div className="hidden min-w-0 lg:block">
            <p className="truncate text-sm font-semibold text-white">Pharma Flow</p>
            <p className="truncate text-[11px] text-sidebar-muted">Prescription intake assistant</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2 lg:p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent/15 text-white ring-1 ring-inset ring-sidebar-accent/40"
                    : "text-sidebar-muted hover:bg-white/5 hover:text-white",
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline">{item.label}</span>
              {item.to === "/app/queue" && stats.pending > 0 ? (
                <span className="ml-auto hidden rounded-full bg-sidebar-accent px-2 py-0.5 text-[11px] font-semibold text-slate-900 lg:inline">
                  {stats.pending}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="hidden border-t border-sidebar-border p-3 lg:block">
          <div className="rounded-lg bg-white/5 p-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-sidebar-muted">
              <Activity className="h-3.5 w-3.5" /> Helper bridge
            </p>
            <p className="mt-1 text-xs text-sidebar-muted">
              Keystroke automation runs on the pharmacy workstation.
            </p>
            <p className="mt-2 font-mono text-[11px] text-sidebar-muted">localhost:48120</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-3 lg:px-5">
          <div className="hidden min-w-0 flex-1 xl:block">
            <h1 className="truncate text-sm font-semibold text-foreground lg:text-base">{title}</h1>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-2 xl:flex-none">
            <HelperStatus />
          </div>

          <QuickActions className="ml-auto" />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
