import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, Printer, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";

interface FaxMed {
  drug_name?: string;
  strength?: string;
  quantity?: number;
  refills?: number;
  sig?: string;
  din?: string;
  is_compound?: boolean;
  sig_hint?: { to: string; hits: number };
  sig_learned?: { to: string; hits: number };
}

interface FaxRow {
  mail_id: number;
  store_id: string;
  received_label: string | null;
  from_label: string | null;
  page_image_url: string | null;
  status: "new" | "pushed" | "dismissed";
  pushed_at: string | null;
  learn_result: { found?: boolean; learned?: boolean } | null;
  ocr: {
    scripts?: Array<{
      patient?: { full_name?: string; dob?: string; health_card_num?: string };
      prescriber?: { name?: string; license_number?: string };
      medications?: FaxMed[];
      overall_confidence?: number;
    }>;
  } | null;
}

interface FaxStats {
  received: { today: number; week: number; month: number };
  cleared: { today: number; week: number; month: number };
  waiting: number | null;
}

type Tab = "new" | "pushed";
const POLL_MS = 10000;

/** Short two-tone beep when a fax arrives. Browsers may block audio until the page was clicked once: ignore that. */
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.15);
    });
    window.setTimeout(() => void ctx.close(), 700);
  } catch {
    /* no audio available */
  }
}

function Counter({ label, cleared, received }: { label: string; cleared: number | null; received: number | null }) {
  return (
    <div className="border-2 border-pf-ink bg-card p-4 dark:border-border">
      <p className="pf-eyebrow text-muted-foreground">{label}</p>
      <p className="pf-display mt-1 text-[44px] leading-none">{cleared ?? "–"}</p>
      <p className="mt-1 font-data text-[11px] text-muted-foreground">cleared · {received ?? "–"} faxes received</p>
    </div>
  );
}

export default function Intake() {
  const { settings, scripts, createManualScript, helperStatus } = useAppStore();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<Tab>("new");
  const [rows, setRows] = React.useState<FaxRow[]>([]);
  const [newCount, setNewCount] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<number | null>(null);
  const [stats, setStats] = React.useState<FaxStats | null>(null);
  const [fresh, setFresh] = React.useState<Set<number>>(new Set());
  const knownNew = React.useRef<Set<number> | null>(null);

  const base = settings.apiBaseUrl.replace(/\/$/, "");
  const headers = React.useMemo(
    () => ({ "Content-Type": "application/json", "x-access-token": settings.apiToken }),
    [settings.apiToken],
  );

  const load = React.useCallback(async () => {
    if (!settings.apiToken) {
      setError("Open Settings and enter the access token.");
      return;
    }
    try {
      const [shown, waiting, statsRes] = await Promise.all([
        fetch(`${base}/api/queue?kind=faxes&status=${tab}`, { headers }),
        tab === "new" ? Promise.resolve(null) : fetch(`${base}/api/queue?kind=faxes&status=new`, { headers }),
        fetch(`${base}/api/queue?kind=fax_stats`, { headers }),
      ]);
      if (shown.status === 401) throw new Error("Wrong access token (Settings)");
      if (!shown.ok) throw new Error(`Server returned ${shown.status}`);
      const data = (await shown.json()) as { rows: FaxRow[] };
      setRows(data.rows);
      if (statsRes.ok) setStats((await statsRes.json()) as FaxStats);
      const newRows = tab === "new" ? data.rows : waiting?.ok ? ((await waiting.json()) as { rows: FaxRow[] }).rows : null;
      if (newRows) {
        setNewCount(newRows.length);
        // A fax that was not in the list before = a new fax arrived: flash it, beep and tell the user.
        const known = knownNew.current;
        const arrived = known ? newRows.filter((f) => !known.has(f.mail_id)) : [];
        knownNew.current = new Set(newRows.map((f) => f.mail_id));
        if (arrived.length) {
          const first = arrived[0].ocr?.scripts?.[0];
          toast.success(`${arrived.length === 1 ? "New fax" : `${arrived.length} new faxes`}: ${first?.patient?.full_name ?? "prescription"} - ${first?.medications?.[0]?.drug_name ?? ""}`);
          beep();
          setFresh(new Set(arrived.map((f) => f.mail_id)));
          window.setTimeout(() => setFresh(new Set()), 4000);
        }
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base, headers, settings.apiToken, tab]);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Browser tab title shows how many faxes are waiting, so it is visible even from another window.
  React.useEffect(() => {
    document.title = newCount ? `(${newCount}) Faxes waiting - Pharma Flow` : "Pharma Flow";
    return () => {
      document.title = "Pharma Flow";
    };
  }, [newCount]);

  /** Make sure the fax exists as a script (the review screen works on scripts) and return its id. */
  const scriptFor = React.useCallback(
    (fax: FaxRow, quiet: boolean): string => {
      const existing = scripts.find((s) => s.faxMailId === fax.mail_id);
      if (existing) return existing.id;
      const s = fax.ocr?.scripts?.[0];
      const m = s?.medications?.[0];
      return createManualScript({
        full_name: s?.patient?.full_name || "UNKNOWN PATIENT",
        dob: s?.patient?.dob || "",
        health_card_num: s?.patient?.health_card_num || "",
        prescriber_name: s?.prescriber?.name || "",
        license_number: s?.prescriber?.license_number || "",
        drug_name: m?.drug_name || "",
        din: m?.din || "",
        strength: m?.strength || "",
        quantity: Number(m?.quantity) || 0,
        refills: Number(m?.refills) || 0,
        sig: m?.sig || "",
        is_compound: Boolean(m?.is_compound),
        source: "fax",
        page_image_url: fax.page_image_url || undefined,
        confidence: s?.overall_confidence,
        store_id: fax.store_id,
        fax_mail_id: fax.mail_id,
        extra_flags: [
          ...(m?.sig_hint ? [`Staff usually change this sig to "${m.sig_hint.to}" (${m.sig_hint.hits}x) - check the dose and timing`] : []),
          ...(m?.sig_learned ? [`Sig was adjusted to match how staff usually write it - please confirm`] : []),
        ],
        quiet,
      });
    },
    [createManualScript, scripts],
  );

  // New faxes become reviewable scripts by themselves, so "Next" in the review screen walks through the whole list.
  React.useEffect(() => {
    if (tab !== "new") return;
    rows.forEach((fax) => {
      if (!scripts.some((s) => s.faxMailId === fax.mail_id)) scriptFor(fax, true);
    });
  }, [rows, scripts, scriptFor, tab]);

  async function dismiss(fax: FaxRow) {
    if (!window.confirm("Remove this fax from the list? Use this when it is not a prescription.")) return;
    setBusy(fax.mail_id);
    try {
      const res = await fetch(`${base}/api/queue`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ kind: "fax", action: "dismiss", store_id: fax.store_id, mail_id: fax.mail_id }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setRows((prev) => prev.filter((r) => r.mail_id !== fax.mail_id));
      void load();
    } catch (e) {
      toast.error(`Could not remove it: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 p-4 lg:p-6">
      {helperStatus !== "connected" && (
        <div className="flex items-start gap-3 border-2 border-pf-amber bg-pf-amber/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            The keystroke helper is not running on this PC, so <b>Push to Kroll</b> cannot type into Kroll here. Start
            <span className="font-data"> workstation_helper.py</span> on this PC first.
          </p>
        </div>
      )}
      {error && <p className="border-2 border-destructive p-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Counter label="Today" cleared={stats?.cleared.today ?? null} received={stats?.received.today ?? null} />
        <Counter label="This week" cleared={stats?.cleared.week ?? null} received={stats?.received.week ?? null} />
        <Counter label="This month" cleared={stats?.cleared.month ?? null} received={stats?.received.month ?? null} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant={tab === "new" ? "default" : "outline"} onClick={() => setTab("new")}>
            To do{newCount != null ? ` (${newCount})` : ""}
          </Button>
          <Button size="sm" variant={tab === "pushed" ? "default" : "outline"} onClick={() => setTab("pushed")}>
            Pushed to Kroll
          </Button>
        </div>
        {tab === "new" && rows.length > 0 && (
          <Button size="sm" onClick={() => navigate(`/app/verify/${scriptFor(rows[0], true)}`)}>
            Start with the first fax
          </Button>
        )}
      </div>

      <ul className="divide-y-2 divide-pf-rule border-2 border-pf-ink bg-card dark:border-border">
        {rows.map((fax) => {
          const s = fax.ocr?.scripts?.[0];
          const m = s?.medications?.[0];
          const conf = s?.overall_confidence != null ? Math.round(s.overall_confidence * 100) : null;
          const weak = conf != null && conf < 85;
          return (
            <li key={fax.mail_id} className={`flex flex-wrap items-center justify-between gap-3 p-4 transition-colors duration-1000 ${fresh.has(fax.mail_id) ? "pf-flash" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold">
                  {s?.patient?.full_name || "Patient not readable"}
                  {s?.patient?.dob ? <span className="ml-2 font-data text-xs font-normal text-muted-foreground">{s.patient.dob}</span> : null}
                </p>
                <p className="mt-0.5 text-sm">
                  {[m?.drug_name, m?.strength].filter(Boolean).join(" ") || "Drug not readable"}
                  <span className="text-muted-foreground"> · qty {m?.quantity ?? "?"} · refills {m?.refills ?? "?"}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {m?.sig || "no sig"} · Dr {s?.prescriber?.name || "?"}
                </p>
                <p className="mt-1 font-data text-[11px] text-muted-foreground">
                  {fax.received_label ?? ""} · {fax.from_label ?? "unknown sender"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {conf != null && (
                  <Badge variant={weak ? "warning" : "outline"} title="How sure the reading is">
                    {conf}%
                  </Badge>
                )}
                {tab === "new" ? (
                  <>
                    <Button size="sm" variant="outline" disabled={busy === fax.mail_id} onClick={() => void dismiss(fax)} title="Not a prescription">
                      {busy === fax.mail_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" onClick={() => navigate(`/app/verify/${scriptFor(fax, false)}`)}>
                      <Printer className="h-4 w-4" /> Review &amp; push
                    </Button>
                  </>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-[#1F7A4D] dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> Pushed {fax.pushed_at ? new Date(fax.pushed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                )}
              </div>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="p-10 text-center text-sm text-muted-foreground">
            {tab === "new" ? "No new prescription faxes. They appear here by themselves." : "Nothing pushed yet."}
          </li>
        )}
      </ul>
    </div>
  );
}
