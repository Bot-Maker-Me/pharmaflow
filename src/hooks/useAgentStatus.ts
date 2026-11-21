import * as React from "react";

import { useAppStore } from "@/store/app-store";

export interface AgentStatus {
  online: boolean;
  host: string | null;
  mode: string | null;
  lastSeen: string | null;
  waiting: number | null;
  known: boolean;
}

const INITIAL: AgentStatus = { online: false, host: null, mode: null, lastSeen: null, waiting: null, known: false };

/** Light poll of the agent heartbeat (same endpoint as the Live page) for the sidebar status panel. */
export function useAgentStatus(intervalMs = 15000): AgentStatus {
  const { settings } = useAppStore();
  const [status, setStatus] = React.useState<AgentStatus>(INITIAL);

  React.useEffect(() => {
    if (!settings.apiToken) {
      setStatus(INITIAL);
      return;
    }
    let cancelled = false;
    const url = `${settings.apiBaseUrl.replace(/\/$/, "")}/api/live`;
    const load = async () => {
      try {
        const res = await fetch(url, { headers: { "x-access-token": settings.apiToken } });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          stats?: { heartbeat?: { last_seen: string; host: string; mode: string; incomplete?: number | null } | null };
        };
        const hb = data.stats?.heartbeat;
        if (cancelled) return;
        if (!hb) {
          setStatus({ ...INITIAL, known: true });
          return;
        }
        setStatus({
          online: Date.now() - Date.parse(hb.last_seen) < 600_000,
          host: hb.host,
          mode: hb.mode,
          lastSeen: hb.last_seen,
          waiting: hb.incomplete ?? null,
          known: true,
        });
      } catch {
        if (!cancelled) setStatus((s) => ({ ...s, known: false }));
      }
    };
    void load();
    const t = window.setInterval(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [settings.apiToken, settings.apiBaseUrl, intervalMs]);

  return status;
}
