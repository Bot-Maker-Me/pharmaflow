import { Activity, Home, Inbox, ListChecks, Settings2, ShieldCheck } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { HelperStatus } from "@/components/HelperStatus";
import { QuickActions } from "@/components/QuickActions";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Intake", icon: Home, end: true },
  { to: "/app/live", label: "Live", icon: Activity, end: false },
  { to: "/app/inbox", label: "Kroll inbox", icon: Inbox, end: false },
  { to: "/app/verify", label: "Verification", icon: ShieldCheck, end: false },
  { to: "/app/queue", label: "Queue", icon: ListChecks, end: false },
  { to: "/app/settings", label: "Settings", icon: Settings2, end: false },
];

function titleFor(pathname: string): { title: string; subtitle: string } {
  if (pathname.includes("/live"))
    return { title: "Live shadow monitor", subtitle: "Agent data compared with staff entry" };
  if (pathname.includes("/inbox"))
    return { title: "Kroll inbox", subtitle: "Pending rows from the local agent" };
  if (pathname.includes("/verify"))
    return { title: "Verification", subtitle: "Document and fields side by side" };
  if (pathname.includes("/queue"))
    return { title: "Queue", subtitle: "Scripts in the intake pipeline" };
  if (pathname.includes("/settings"))
    return { title: "Settings", subtitle: "Agent, extraction, and store isolation" };
  return { title: "Intake", subtitle: "Fax and prescription capture" };
}

export function AppShell() {
  const { stats } = useAppStore();
  const location = useLocation();
  const { title, subtitle } = titleFor(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:w-56">
        <div className="flex h-14 items-center gap-3 border-b-2 border-sidebar-border px-3 lg:px-4">
          <Link to="/" className="flex items-center gap-2.5 min-w-0">
            <span
              aria-hidden
              className="relative flex h-8 w-8 shrink-0 items-center justify-center border-2 border-pf-sheet/90 bg-pf-ink"
            >
              <span className="h-[18px] w-[2.5px] rotate-[35deg] bg-pf-amber" />
            </span>
            <div className="hidden min-w-0 lg:block">
              <p className="truncate text-[16px] font-bold tracking-tight text-sidebar-foreground">
                Pharma Flow
              </p>
            </div>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 border-l-[3px] px-2.5 py-2 text-[14px] font-semibold transition-colors",
                  isActive
                    ? "border-pf-amber bg-white/[0.08] text-pf-sheet"
                    : "border-transparent text-sidebar-muted hover:bg-white/[0.05] hover:text-sidebar-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="hidden truncate lg:inline">{item.label}</span>
              {item.to === "/app/queue" && stats.pending > 0 ? (
                <span className="ml-auto hidden bg-pf-amber px-1.5 py-0.5 font-data text-[10px] font-medium text-pf-ink lg:inline">
                  {stats.pending}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="hidden border-t-2 border-sidebar-border p-3 lg:block">
          <p className="pf-eyebrow text-pf-amber">
            Helper
          </p>
          <p className="mt-1 text-[11px] leading-snug text-sidebar-muted">
            Keystroke agent on the pharmacy PC
          </p>
          <p className="mt-2 font-data text-[10px] text-sidebar-muted/80">localhost:48120</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-14 shrink-0 items-center gap-3 border-b-2 border-pf-ink bg-background/90 px-3 backdrop-blur-sm dark:border-border lg:px-5">
          <div className="hidden min-w-0 flex-1 xl:block">
            <h1 className="pf-display truncate text-[24px] text-foreground">{title}</h1>
            <p className="truncate font-data text-[11px] text-muted-foreground">{subtitle}</p>
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
