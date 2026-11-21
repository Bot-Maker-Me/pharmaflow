import * as React from "react";
import { Activity, Home, Inbox, ListChecks, Settings2, ShieldCheck } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { HelperStatus } from "@/components/HelperStatus";
import { QuickActions } from "@/components/QuickActions";
import { useAgentStatus } from "@/hooks/useAgentStatus";
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

function AgentPanel() {
  const agent = useAgentStatus();
  const { helperStatus, settings } = useAppStore();
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, []);
  const secs = agent.lastSeen ? Math.max(0, Math.round((Date.now() - Date.parse(agent.lastSeen)) / 1000)) : null;
  const seen =
    secs === null ? "never" : secs < 60 ? `${secs}s ago` : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`;
  const label = !agent.known ? "Agent status unknown" : agent.online ? `Online${agent.mode ? ` · ${agent.mode}` : ""}` : "Agent OFFLINE";
  const dot = !agent.known ? "bg-pf-slate" : agent.online ? "bg-[#1F7A4D]" : "bg-destructive";

  return (
    <div className="border-t-2 border-pf-ink bg-background p-2 dark:border-border lg:p-4">
      <div className="flex justify-center lg:hidden" title={label}>
        <span className={cn("h-3 w-3 rounded-full", dot, agent.online && "animate-pulse")} />
      </div>
      <div className="hidden lg:block">
        <p className="pf-eyebrow text-muted-foreground">Agent</p>
        <p className="mt-2 flex items-center gap-2 text-[14px] font-bold">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dot, agent.online && "animate-pulse")} />
          {label}
        </p>
        <div className="mt-2 flex justify-between font-data text-[11px] text-muted-foreground">
          <span className="truncate">{agent.host ?? "no heartbeat"}</span>
          <span className="shrink-0 pl-2">{seen}</span>
        </div>
        {agent.waiting ? (
          <div className="mt-1 flex justify-between font-data text-[11px] text-muted-foreground">
            <span>Waiting</span>
            <span>{agent.waiting}</span>
          </div>
        ) : null}
        <div className="mt-3 flex justify-between border-t border-pf-rule pt-2 font-data text-[11px] text-muted-foreground">
          <span>Keystroke helper</span>
          <span className={helperStatus === "connected" ? "text-[#1F7A4D] dark:text-emerald-400" : ""}>
            {helperStatus === "connected" ? "connected" : helperStatus === "checking" ? "checking" : "offline"}
          </span>
        </div>
        <p className="mt-1 truncate font-data text-[10px] text-muted-foreground/80">{settings.helperUrl}</p>
      </div>
    </div>
  );
}

export function AppShell() {
  const { stats } = useAppStore();
  const location = useLocation();
  const { title, subtitle } = titleFor(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-16 shrink-0 flex-col border-r-2 border-pf-ink bg-card text-foreground dark:border-border lg:w-64">
        <div className="flex h-14 items-center justify-center gap-3 border-b-2 border-pf-ink px-2 dark:border-border lg:justify-start lg:px-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-pf-ink bg-pf-ink dark:border-pf-sheet"
            >
              <span className="h-5 w-[3px] rotate-[35deg] bg-pf-amber" />
            </span>
            <span className="pf-display hidden truncate text-[26px] lg:block">Pharma Flow</span>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1.5 p-2 lg:p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  "flex h-11 items-center justify-center gap-3 border-2 text-[16px] font-bold transition-[background,box-shadow,color] lg:h-12 lg:justify-start lg:px-3.5",
                  isActive
                    ? "border-pf-ink bg-pf-ink text-pf-sheet shadow-[4px_4px_0_0_#F28C1B] dark:border-pf-amber dark:bg-pf-amber dark:text-pf-ink dark:shadow-none"
                    : "border-transparent text-foreground hover:border-pf-ink hover:bg-pf-amber/15 dark:hover:border-border",
                )
              }
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              <span className="hidden truncate lg:inline">{item.label}</span>
              {item.to === "/app/queue" && stats.pending > 0 ? (
                <span className="ml-auto hidden bg-pf-amber px-1.5 py-0.5 font-data text-[11px] font-medium text-pf-ink lg:inline">
                  {stats.pending}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <AgentPanel />
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
