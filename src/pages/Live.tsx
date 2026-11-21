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

interface InboundFaxes {
  last_24h: number;
  prescriptions_24h: number;
  items: Array<{
    mail_id: number;
    created_at: string;
    received: string | null;
    from: string | null;
    doc_type: string | null;
    is_prescription: boolean;
    summary: string | null;
    drug: string | null;
    confidence: number | null;
  }>;
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
        <p className="pf-eyebrow text-muted-foreground">{label}</p>
        <p className="pf-display mt-2 text-[46px] tabular-nums">{value}</p>
        {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function Live() {
  const { settings } = useAppStore();
  const [stats, setStats] = React.useState<LiveStats | null>(null);
  const [rows, setRows] = React.useState<LiveRow[]>([]);
  const [faxes, setFaxes] = React.useState<InboundFaxes | null>(null);
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
      const data = (await response.json()) as { stats: LiveStats; rows: LiveRow[]; inbound_faxes?: InboundFaxes };
      setStats(data.stats);
      setFaxes(data.inbound_faxes ?? null);
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
  const faxTimes = (faxes?.items ?? []).map((f) => Date.parse(f.created_at));
  const faxesLastMinute = faxTimes.filter((t) => now - t < 60_000).length;
  const faxesLastHour = faxTimes.filter((t) => now - t < 3_600_000).length;
  const chart = (stats?.per_minute ?? []).map((p) => {
    const start = Date.parse(p.t);
    return {
      time: new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      n: p.n,
      f: faxTimes.filter((t) => t >= start && t < start + 60_000).length,
    };
  });
  const fields = Object.entries(stats?.fields ?? {});
  const reasons = Object.entries(stats?.reasons ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={agentOnline ? "default" : "destructive"} className="gap-2 py-1">
            <span className={`h-2 w-2 rounded-full ${agentOnline ? "animate-pulse bg-pf-amber" : "bg-destructive"}`} />
            Agent {agentOnline ? "online" : "OFFLINE"}
            {stats?.heartbeat && ` · ${stats.heartbeat.host} · ${stats.heartbeat.mode}${stats.heartbeat.version ? ` · agent v${stats.heartbeat.version}` : ""}`}
          </Badge>
          <span className="font-data text-[11px] text-muted-foreground">
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
          <Button size="sm" variant="amber" onClick={() => void startShadowWeek()}>
            <PlayCircle className="h-4 w-4" /> Start shadow week now
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
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
        <Stat label="Last minute" value={stats?.last_minute ?? "–"} hint={`prescriptions received · ${faxesLastMinute} fax read`} />
        <Stat label="Last hour" value={stats?.last_hour ?? "–"} hint={`${faxesLastHour} faxes read from Inbound Docs`} />
        <Stat label="Counted this week" value={stats?.since_start ?? "–"} />
        <Stat label="Would be AUTO" value={`${autoPct}%`} hint={`${stats?.auto ?? 0} auto · ${stats?.exception ?? 0} to a person`} />
        <Stat label="Compared with staff" value={stats?.compared ?? 0} hint={`${stats?.waiting ?? 0} waiting for staff entry`} />
        <Stat label="Never entered" value={stats?.never_entered ?? 0} hint="gave up after 3 days" />
      </div>

      {stats && stats.since_start > 0 && stats.compared === 0 && stats.waiting === 0 && stats.auto === 0 && (
        <Card className="border-pf-amber bg-pf-amber/10">
          <CardContent className="p-3 text-sm">
            Nothing is AUTO yet, so nothing can be compared. See the reasons below — usually a column in the
            [Schema] section of config.ini points at the wrong Kroll column. Run{" "}
            <code className="bg-muted px-1 font-data text-[12px]">python flow.py --profile PendingNewRx</code> on the server and send me the output.
          </CardContent>
        </Card>
      )}
      {stats && stats.auto > 0 && stats.compared === 0 && (
        <Card className="border-pf-amber bg-pf-amber/10">
          <CardContent className="p-3 text-sm">
            Staff comparison has not produced results yet. Either staff have not entered those prescriptions in Kroll
            yet, or the [RxSchema] section in config.ini is missing so flow.py cannot find the Rx they typed.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle>Prescriptions (orange) and faxes read (green) per minute · last 30 min</CardTitle>
          </CardHeader>
          <CardContent className="h-56 min-h-56 flex-1 pt-0 lg:h-auto">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid stroke="#C5CDD1" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fontFamily: "IBM Plex Mono, monospace", fill: "#56636D" }} interval={4} axisLine={{ stroke: "#101418", strokeWidth: 2 }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontFamily: "IBM Plex Mono, monospace", fill: "#56636D" }} allowDecimals={false} width={32} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "rgba(242,140,27,0.12)" }} contentStyle={{ borderRadius: 0, border: "2px solid #101418", background: "#FAFAF7", fontFamily: "IBM Plex Mono, monospace", fontSize: 11 }} />
                <Bar dataKey="n" fill="#F28C1B" isAnimationActive={false} />
                <Bar dataKey="f" fill="#1F7A4D" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Agent vs staff match</CardTitle>
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
                    <div className="flex items-baseline justify-between">
                      <span className="font-data text-[12px] font-medium">{name}</span>
                      <span className="font-data text-[11px] tabular-nums text-muted-foreground">
                        <span className={pct >= 99.5 ? "font-medium text-[#1F7A4D] dark:text-emerald-400" : "font-medium text-foreground"}>{pct.toFixed(1)}%</span>{" "}
                        ({f.match}/{f.total})
                      </span>
                    </div>
                    <div className="relative mt-1.5 h-3 border-2 border-pf-ink bg-card dark:border-border">
                      <div className={`h-full ${pct >= 99.5 ? "bg-[#1F7A4D]" : "bg-pf-amber"}`} style={{ width: `${pct}%` }} />
                      <span aria-hidden className="absolute -bottom-0.5 -top-0.5 w-0.5 bg-pf-ink dark:bg-pf-sheet" style={{ left: "99.5%" }} />
                    </div>
                  </div>
                );
              })
            )}
            {reasons.length > 0 && (
              <div className="border-t-2 border-pf-ink pt-3 dark:border-border">
                <p className="pf-eyebrow mb-2">Why rows go to a person</p>
                {reasons.map(([reason, n]) => (
                  <div key={reason} className="flex justify-between border-b border-pf-rule py-1 text-xs last:border-0">
                    <span className="text-muted-foreground">{reason}</span>
                    <span className="font-data font-medium tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Inbound faxes</CardTitle>
          <CardDescription>
            Faxes read from Kroll&apos;s Inbound Docs before staff open them: {faxes?.last_24h ?? 0} in the last 24h,{" "}
            {faxes?.prescriptions_24h ?? 0} look like prescriptions. Ads and reports are listed but not treated as prescriptions.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="divide-y divide-pf-rule border border-pf-rule bg-card">
            {(faxes?.items ?? []).slice(0, 15).map((f) => (
              <li key={f.mail_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-28 font-data text-muted-foreground tabular-nums">{f.received ?? "–"}</span>
                  <span className="truncate font-data font-medium">{f.from ?? "unknown"}</span>
                  <span className="truncate text-muted-foreground">{f.drug ?? f.summary ?? ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  {f.confidence != null && <span className="font-data text-muted-foreground">{Math.round(f.confidence * 100)}%</span>}
                  {f.is_prescription ? <Badge variant="success">PRESCRIPTION</Badge> : <Badge variant="outline">OTHER</Badge>}
                </div>
              </li>
            ))}
            {(faxes?.items.length ?? 0) === 0 && (
              <li className="p-6 text-center text-sm text-muted-foreground">No inbound faxes read yet.</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Live feed</CardTitle>
          <CardDescription>Newest first, refreshes every {POLL_MS / 1000}s. No patient names are shown here.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="divide-y divide-pf-rule border border-pf-rule bg-card">
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
                    fresh.has(row.id) ? "pf-flash" : "hover:bg-pf-amber/10"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-16 font-data text-muted-foreground tabular-nums">{ago(row.received_at, now)}</span>
                    <span className="font-data font-medium">Rx #{row.pending_rx_id}</span>
                    <span className="font-data text-muted-foreground">
                      drug {row.drug_id ?? "–"} · qty {row.qty ?? "–"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.decision === "AUTO" ? (
                      <Badge variant="success">AUTO</Badge>
                    ) : (
                      <Badge variant="warning" title={(row.decision_issues ?? []).join(", ")}>
                        EXCEPTION{row.decision_issues?.length ? ` · ${row.decision_issues[0]}` : ""}
                      </Badge>
                    )}
                    {row.decision === "AUTO" &&
                      (row.compared_at && row.actual ? (
                        mismatches.length === 0 ? (
                          <span className="flex items-center gap-1 font-medium text-[#1F7A4D] dark:text-emerald-400">
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
