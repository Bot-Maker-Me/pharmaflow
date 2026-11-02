import * as React from "react";
import { Activity, AlertTriangle, CheckCircle2, Pause, Play, PlayCircle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/store/app-store";

interface FieldStat {
  match: number;
  total: number;
}

interface LiveStats {
  server_time: string;
  live_since: string | null;
  total_rows: number;
  backlog_rows: number;
  since_start: number;
  auto: number;
  exception: number;
  compared: number;
  waiting: number;
  never_entered: number;
  last_minute: number;
  last_hour: number;
  last_received: string | null;
  fields: Record<string, FieldStat>;
  reasons: Record<string, number>;
  per_minute: Array<{ t: string; n: number }>;
  heartbeat: { last_seen: string; host: string; mode: string; store_id: string; version?: string; incomplete?: number | null } | null;
}

interface LiveRow {
  id: number;
  pending_rx_id: number;
  drug_id: string | null;
  qty: string | null;
  decision: "AUTO" | "EXCEPTION" | null;
  decision_issues: string[] | null;
  planned: Record<string, unknown> | null;
  actual: Record<string, unknown> | null;
  field_match: Record<string, boolean> | null;
  received_at: string;
  compared_at: string | null;
}

const POLL_MS = 3000;

function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function Live() {
  const { settings } = useAppStore();
  const [stats, setStats] = React.useState<LiveStats | null>(null);
  const [rows, setRows] = React.useState<LiveRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [paused, setPaused] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  const [fresh, setFresh] = React.useState<Set<number>>(new Set());
  const seen = React.useRef<Set<number> | null>(null);

  const endpoint = `${settings.apiBaseUrl.replace(/\/$/, "")}/api/live`;
  const headers = React.useMemo(
    () => ({ "Content-Type": "application/json", "x-access-token": settings.apiToken }),
    [settings.apiToken],
  );

  const load = React.useCallback(async () => {
    if (!settings.apiToken) {
      setError("Set the API access token in Settings first.");
      return;
    }
    try {
      const response = await fetch(endpoint, { headers });
      if (response.status === 401) throw new Error("Wrong API access token (Settings)");
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = (await response.json()) as { stats: LiveStats; rows: LiveRow[] };
      setStats(data.stats);
      setRows(data.rows);
      setError(null);
      const ids = new Set(data.rows.map((r) => r.id));
      if (seen.current) {
        const added = new Set<number>();
        ids.forEach((id) => {
          if (!seen.current!.has(id)) added.add(id);
        });
        if (added.size) {
          setFresh(added);
          window.setTimeout(() => setFresh(new Set()), 2500);
        }
      }
      seen.current = ids;
    } catch (e) {
      setError((e as Error).message);
    }
  }, [endpoint, headers, settings.apiToken]);

  React.useEffect(() => {
    void load();
    if (paused) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, paused]);

  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  async function startShadowWeek() {
    if (!window.confirm("Start (or restart) the shadow week now? Everything received before this moment becomes 'backlog' and is excluded from rates and nightly reports.")) return;
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ action: "start_shadow_week" }) });
    if (response.ok) {
      toast.success("Shadow week started — counters reset.");
      void load();
    } else {
      toast.error(`Failed (${response.status})`);
    }
  }

  const hbAge = stats?.heartbeat ? (now - Date.parse(stats.heartbeat.last_seen)) / 1000 : null;
  const agentOnline = hbAge !== null && hbAge < 600;
  const flowing = stats?.last_received ? (now - Date.parse(stats.last_received)) / 1000 < 120 : false;
  const total = (stats?.auto ?? 0) + (stats?.exception ?? 0);
  const autoPct = total ? Math.round((100 * (stats?.auto ?? 0)) / total) : 0;
  const chart = (stats?.per_minute ?? []).map((p) => ({
    time: new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    n: p.n,
  }));
  const fields = Object.entries(stats?.fields ?? {});
  const reasons = Object.entries(stats?.reasons ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={agentOnline ? "default" : "destructive"} className="gap-1.5">
            <span className={`h-2 w-2 rounded-full ${agentOnline ? "animate-pulse bg-emerald-300" : "bg-red-300"}`} />
            Agent {agentOnline ? "online" : "OFFLINE"}
            {stats?.heartbeat && ` · ${stats.heartbeat.host} · ${stats.heartbeat.mode}${stats.heartbeat.version ? ` · agent v${stats.heartbeat.version}` : ""}`}
          </Badge>
          <span className="text-xs text-muted-foreground">
            last heartbeat {ago(stats?.heartbeat?.last_seen, now)} · last Rx {ago(stats?.last_received, now)}
          </span>
          {!!stats?.heartbeat?.incomplete && (
            <Badge variant="outline">{stats.heartbeat.incomplete} waiting for Kroll staff to fill in</Badge>
          )}
          {flowing && (
            <Badge variant="outline" className="gap-1">
              <Activity className="h-3 w-3 animate-pulse" /> data flowing
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" onClick={() => void startShadowWeek()}>
            <PlayCircle className="h-4 w-4" /> Start shadow week now
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-2 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      {stats && stats.backlog_rows > 0 && (
        <p className="text-xs text-muted-foreground">
          {stats.backlog_rows.toLocaleString()} older rows were received before the shadow week started (backlog). They
          show in the feed but are not counted in the numbers below.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Last minute" value={stats?.last_minute ?? "–"} hint="prescriptions received" />
        <Stat label="Last hour" value={stats?.last_hour ?? "–"} />
        <Stat label="Counted this week" value={stats?.since_start ?? "–"} />
        <Stat label="Would be AUTO" value={`${autoPct}%`} hint={`${stats?.auto ?? 0} auto · ${stats?.exception ?? 0} to a person`} />
        <Stat label="Compared with staff" value={stats?.compared ?? 0} hint={`${stats?.waiting ?? 0} waiting for staff entry`} />
        <Stat label="Never entered" value={stats?.never_entered ?? 0} hint="gave up after 3 days" />
      </div>

      {stats && stats.since_start > 0 && stats.compared === 0 && stats.waiting === 0 && stats.auto === 0 && (
        <Card className="border-amber-500/50">
          <CardContent className="p-3 text-sm">
            Nothing is AUTO yet, so nothing can be compared. See the reasons below — usually a column in the
            [Schema] section of config.ini points at the wrong Kroll column. Run{" "}
            <code className="rounded bg-muted px-1">python flow.py --profile PendingNewRx</code> on the server and send me the output.
          </CardContent>
        </Card>
      )}
      {stats && stats.auto > 0 && stats.compared === 0 && (
        <Card className="border-amber-500/50">
          <CardContent className="p-3 text-sm">
            Staff comparison has not produced results yet. Either staff have not entered those prescriptions in Kroll
            yet, or the [RxSchema] section in config.ini is missing so flow.py cannot find the Rx they typed.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Prescriptions per minute (last 30 min)</CardTitle>
          </CardHeader>
          <CardContent className="h-56 pt-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={4} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={32} />
                <Tooltip />
                <Bar dataKey="n" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Agent vs staff match</CardTitle>
            <CardDescription>Needs ≥ 99.5% per field before going live</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {fields.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No comparisons yet.</p>
            ) : (
              fields.map(([name, f]) => {
                const pct = f.total ? (100 * f.match) / f.total : 0;
                return (
                  <div key={name}>
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {pct.toFixed(1)}% ({f.match}/{f.total})
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
                      <div className={`h-full ${pct >= 99.5 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
            {reasons.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs font-medium">Why rows go to a person</p>
                {reasons.map(([reason, n]) => (
                  <div key={reason} className="flex justify-between text-xs text-muted-foreground">
                    <span>{reason}</span>
                    <span className="tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Live feed</CardTitle>
          <CardDescription>Newest first, refreshes every {POLL_MS / 1000}s. No patient names are shown here.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((row) => {
              const mismatches = row.field_match
                ? Object.entries(row.field_match)
                    .filter(([, ok]) => !ok)
                    .map(([k]) => k)
                : [];
              return (
                <li
                  key={row.id}
                  className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs transition-colors duration-1000 ${
                    fresh.has(row.id) ? "bg-primary/15" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-16 text-muted-foreground tabular-nums">{ago(row.received_at, now)}</span>
                    <span className="font-mono">Rx #{row.pending_rx_id}</span>
                    <span className="text-muted-foreground">
                      drug {row.drug_id ?? "–"} · qty {row.qty ?? "–"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.decision === "AUTO" ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">AUTO</Badge>
                    ) : (
                      <Badge variant="outline" title={(row.decision_issues ?? []).join(", ")}>
                        EXCEPTION{row.decision_issues?.length ? ` · ${row.decision_issues[0]}` : ""}
                      </Badge>
                    )}
                    {row.decision === "AUTO" &&
                      (row.compared_at && row.actual ? (
                        mismatches.length === 0 ? (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="h-3.5 w-3.5" /> matches staff
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5" /> differs: {mismatches.join(", ")}
                          </span>
                        )
                      ) : row.compared_at ? (
                        <span className="text-muted-foreground">never entered</span>
                      ) : (
                        <span className="text-muted-foreground">waiting for staff…</span>
                      ))}
                  </div>
                </li>
              );
            })}
            {rows.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No rows yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
