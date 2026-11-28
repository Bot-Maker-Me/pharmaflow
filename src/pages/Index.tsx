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
  is_prescription?: boolean;
  kroll_patient?: { status: "exact" | "corrected" | "ambiguous" | "none"; first: string; last: string; score: number; n_dob: number; dob_swapped: boolean; dob?: string; matched_by?: "dob" | "name" | "address" | "name+address"; tie_broken?: boolean; candidates?: Array<{ first: string; last: string; score: number }> } | null;
  kroll_enrich?: {
    doctor?: { status: "found" | "by_name" | "by_address" | "several" | "none"; first: string; last: string; licence: string; name_ok: boolean | null };
    meds?: Array<{ drug: { candidates: Array<{ din: string; name: string; uses: number; in_history: boolean }>; pick: string | null; reason: string; replaces?: string }; last_rx: { din: string; sig: string; qty: number | null; refills: number | null; filled: string } | null; din_fill: string }>;
    drug?: { candidates: Array<{ din: string; name: string; uses: number; in_history: boolean }>; pick: string | null; reason: string; replaces?: string };
    last_rx?: { din: string; sig: string; qty: number | null; refills: number | null; filled: string } | null;
    fills?: { licence?: string; din?: string; doctor_name?: string };
  } | null;
  doc_type?: string | null;
  summary?: string | null;
  page_image_url: string | null;
  status: "new" | "pushed" | "dismissed";
  pushed_at: string | null;
  learn_result: { found?: boolean; learned?: boolean } | null;
  ocr: {
    scripts?: Array<{
      patient?: { full_name?: string; dob?: string; address?: string; health_card_num?: string };
      prescriber?: { name?: string; license_number?: string; address?: string; phone?: string; fax?: string };
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
  const { settings, scripts, createManualScript, helperStatus, updatePatient, updatePrescriber, updateMedication, updateScript } = useAppStore();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<Tab>("new");
  const [rows, setRows] = React.useState<FaxRow[]>([]);
  const [newCount, setNewCount] = React.useState<number | null>(null);
  const [todayCount, setTodayCount] = React.useState<number | null>(null);
  const [day, setDay] = React.useState<"today" | "all">("today");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<number | null>(null);
  const [stats, setStats] = React.useState<FaxStats | null>(null);
  const [fresh, setFresh] = React.useState<Set<number>>(new Set());
  const knownNew = React.useRef<Set<number> | null>(null);
  const firstSeen = React.useRef<Map<number, number>>(new Map());

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
        fetch(`${base}/api/queue?kind=faxes&status=${tab}&day=${tab === "new" ? day : "all"}`, { headers }),
        tab === "new" && day === "all" ? Promise.resolve(null) : fetch(`${base}/api/queue?kind=faxes&status=new&day=all`, { headers }),
        fetch(`${base}/api/queue?kind=fax_stats`, { headers }),
      ]);
      if (shown.status === 401) throw new Error("Wrong access token (Settings)");
      if (!shown.ok) throw new Error(`Server returned ${shown.status}`);
      const data = (await shown.json()) as { rows: FaxRow[]; total?: number; today_count?: number };
      setRows(data.rows);
      if (tab === "new") {
        setTodayCount(data.today_count ?? null);
        if (day === "all") setNewCount(data.total ?? data.rows.length);
      }
      if (statsRes.ok) setStats((await statsRes.json()) as FaxStats);
      let newRows: FaxRow[] | null = null;
      if (waiting?.ok) {
        const w = (await waiting.json()) as { rows: FaxRow[]; total?: number; today_count?: number };
        newRows = w.rows;
        setNewCount(w.total ?? w.rows.length);
        setTodayCount(w.today_count ?? null);
      } else if (tab === "new") newRows = data.rows;
      if (newRows) {
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
  }, [base, headers, settings.apiToken, tab, day]);

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
      const kp = fax.kroll_patient;
      const useKroll = kp && (kp.status === "exact" || kp.status === "corrected" || kp.status === "ambiguous") && kp.last;
      const faxName = s?.patient?.full_name || "UNKNOWN PATIENT";
      const en = fax.kroll_enrich;
      const faxDin = (m?.din || "").replace(/\D/g, "");
      const fillDin = en?.fills?.din && en.fills.din !== faxDin ? en.fills.din : "";
      const fillLic = !s?.prescriber?.license_number && en?.fills?.licence ? en.fills.licence : "";
      const fillDoc = en?.fills?.doctor_name || "";
      const lr = en?.last_rx;
      const dr = en?.doctor;
      return createManualScript({
        full_name: useKroll ? `${kp.last}, ${kp.first}` : faxName,
        dob: s?.patient?.dob || (useKroll ? kp.dob || "" : ""),
        health_card_num: s?.patient?.health_card_num || "",
        prescriber_name: fillDoc || s?.prescriber?.name || "",
        license_number: s?.prescriber?.license_number || fillLic,
        drug_name: m?.drug_name || "",
        din: fillDin || m?.din || "",
        extra_meds: (s?.medications ?? []).slice(1).map((mx, i) => {
          const em = en?.meds?.[i + 1];
          const dinX = (mx?.din || "").replace(/\D/g, "");
          const fillX = em?.din_fill && em.din_fill !== dinX ? em.din_fill : "";
          return {
            drug_name: mx?.drug_name || "",
            din: fillX || mx?.din || "",
            strength: mx?.strength || "",
            quantity: Number(mx?.quantity) || 0,
            refills: Number(mx?.refills) || 0,
            sig: mx?.sig || "",
            is_compound: Boolean(mx?.is_compound),
            ...(em?.drug?.candidates?.length && (!dinX || fillX) ? {
              din_source: fillX ? "kroll_unique_match" : "kroll_candidates",
              din_candidates: em.drug.candidates.map((c) => ({ din: c.din, brand: c.name, company: "", strength: mx?.strength || "", form: "", uses: c.uses })),
            } : {}),
          };
        }),
        ...(en?.drug?.candidates?.length && (!faxDin || fillDin) ? {
          din_source: fillDin ? "kroll_unique_match" : "kroll_candidates",
          din_candidates: en.drug.candidates.map((c) => ({ din: c.din, brand: c.name, company: "", strength: m?.strength || "", form: "", uses: c.uses })),
        } : {}),
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
        fax_received: fax.received_label ?? undefined,
        fax_from: fax.from_label ?? undefined,
        extra_flags: [
          ...(useKroll && kp.status === "corrected" ? [`Name on the fax: "${faxName}". Kroll's patient with this date of birth is "${kp.first} ${kp.last}"${kp.dob_swapped ? " (date read with day and month swapped)" : ""}${kp.matched_by && kp.matched_by !== "dob" ? ` - found by ${kp.matched_by}` : ""} - check it is the same person`] : []),
          ...(kp?.status === "ambiguous" ? [`${kp.n_dob} Kroll patients share this date of birth (${(kp.candidates ?? []).map((c) => `${c.first} ${c.last}`).join(" / ")}). Best guess used: ${kp.first} ${kp.last} - check it in Kroll's patient list`] : []),
          ...(kp?.tie_broken ? [`Two Kroll patients fit this name and date of birth; chose ${kp.first} ${kp.last} (full name on the fax, or the one with recent prescriptions) - check it`] : []),
          ...(useKroll && !s?.patient?.dob && kp.dob ? [`No date of birth on the fax: ${kp.dob} taken from Kroll (patient matched by ${kp.matched_by === "address" ? "address" : "name and address"}) - check it is the same person`] : []),
          ...(useKroll && s?.patient?.dob && kp.dob && kp.matched_by !== "dob" && kp.dob !== s.patient.dob ? [`Date of birth on the fax (${s.patient.dob}) differs from Kroll (${kp.dob}) - check the patient`] : []),
          ...(fillDoc ? [`Doctor name on the fax ("${s?.prescriber?.name}") replaced by Kroll's "${fillDoc}", found by the clinic's phone / fax / address - check it`] : []),
          ...(fillLic ? [`Licence ${fillLic} filled in from Kroll (Dr ${dr?.first} ${dr?.last}, found by name) - the fax had none`] : []),
          ...(fillDin ? [`DIN ${fillDin} taken from Kroll (${en?.drug?.reason})${faxDin ? `; replaces ${faxDin} read from the fax, which is not a Kroll product` : ""} - check it is the product you want`] : []),
          ...(dr?.status === "found" && dr.name_ok === false ? [`Licence on the fax belongs to Dr ${dr.first} ${dr.last} in Kroll, but the fax says "${s?.prescriber?.name}" - check the doctor`] : []),
          ...(dr?.status === "by_name" && dr.licence && s?.prescriber?.license_number && dr.licence.replace(/\W/g, "") !== s.prescriber.license_number.replace(/\W/g, "") ? [`Kroll has licence ${dr.licence} for Dr ${dr.first} ${dr.last}; the fax says ${s.prescriber.license_number} - check which is right`] : []),
          ...(dr?.status === "several" ? [`Several doctors in Kroll match "${s?.prescriber?.name}" and the licence is missing - pick the doctor in Kroll`] : []),
          ...(en?.drug && !faxDin && !fillDin && en.drug.candidates.length > 1 ? [`${en.drug.candidates.length} Kroll products match this drug - staff pick the DIN`] : []),
          ...(lr ? [`Kroll's last Rx of this drug${lr.filled ? ` (${lr.filled})` : ""}: sig "${lr.sig ?? "?"}", qty ${lr.qty ?? "?"}, refills ${lr.refills ?? "?"}${m?.quantity && lr.qty != null && Number(lr.qty) !== Number(m.quantity) ? " - quantity differs from the fax" : ""}`] : []),
          ...((s?.medications ?? []).slice(1).flatMap((mx, i) => {
            const em = en?.meds?.[i + 1];
            const dinX0 = (mx?.din || "").replace(/\D/g, "") !== em?.din_fill ? (mx?.din || "").replace(/\D/g, "") : "";
            const out: string[] = [];
            if (em?.din_fill) out.push(`${mx?.drug_name}: DIN ${em.din_fill} taken from Kroll (${em.drug.reason})${dinX0 ? `; replaces ${dinX0} read from the fax` : ""} - check it`);
            else if (em && em.drug.candidates.length > 1 && !(mx?.din || "")) out.push(`${mx?.drug_name}: ${em.drug.candidates.length} Kroll products match - staff pick the DIN`);
            if (em?.last_rx) out.push(`${mx?.drug_name}: Kroll's last Rx${em.last_rx.filled ? ` (${em.last_rx.filled})` : ""} was sig "${em.last_rx.sig ?? "?"}", qty ${em.last_rx.qty ?? "?"}, refills ${em.last_rx.refills ?? "?"}`);
            return out;
          })),
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
    const now = Date.now();
    // A review screen made before the Kroll lookup finished still has the fax's name: replace it, unless staff edited it.
    rows.forEach((fax) => {
      const kp = fax.kroll_patient;
      const existing = scripts.find((x) => x.faxMailId === fax.mail_id);
      const faxName = fax.ocr?.scripts?.[0]?.patient?.full_name;
      if (existing && kp?.last && kp.status !== "none" && existing.status === "pending" && faxName && existing.patient.full_name === faxName) {
        updatePatient(existing.id, { full_name: `${kp.last}, ${kp.first}` });
      }
    });
    // Same for the doctor's licence and the DIN: fill them from Kroll when the review screen still has them empty.
    rows.forEach((fax) => {
      const en = fax.kroll_enrich;
      const existing = scripts.find((x) => x.faxMailId === fax.mail_id);
      if (existing && existing.status === "pending" && fax.kroll_patient?.dob && fax.kroll_patient.status !== "none" && !existing.patient.dob) updatePatient(existing.id, { dob: fax.kroll_patient.dob });
      // A review screen made before extra medications were supported only has the first one: add the rest.
      const faxMeds = fax.ocr?.scripts?.[0]?.medications ?? [];
      if (existing && existing.status === "pending" && faxMeds.length > existing.medications.length) {
        const more = faxMeds.slice(existing.medications.length).map((x) => ({
          id: `med-${fax.mail_id}-${Math.random().toString(36).slice(2, 8)}`,
          drug_name: x?.drug_name || "", din: x?.din || "", strength: x?.strength || "", quantity: Number(x?.quantity) || 0,
          refills: Number(x?.refills) || 0, sig: x?.sig || "", is_compound: Boolean(x?.is_compound), confidence: 0.9, din_status: (x?.is_compound ? "compound" : "unverified") as "compound" | "unverified",
          field_scores: { drug_name: 0.85, din: x?.din ? 0.9 : 0.2, strength: x?.strength ? 0.9 : 0.2, quantity: x?.quantity ? 0.95 : 0.3, refills: 0.9, sig: x?.sig ? 0.9 : 0.3 },
        }));
        updateScript(existing.id, { medications: [...existing.medications, ...more] });
      }
      if (!en || !existing || existing.status !== "pending") return;
      if (en.fills?.doctor_name && existing.prescriber.name === fax.ocr?.scripts?.[0]?.prescriber?.name) updatePrescriber(existing.id, { name: en.fills.doctor_name });
      if (en.fills?.licence && !existing.prescriber.license_number) updatePrescriber(existing.id, { license_number: en.fills.licence });
      existing.medications.forEach((med, i) => {
        const f = en.meds?.[i]?.din_fill || (i === 0 ? en.fills?.din : "");
        const rep = en.meds?.[i]?.drug?.replaces || "";
        if (f && (!med.din || (rep && med.din.replace(/\D/g, "") === rep))) updateMedication(existing.id, med.id, { din: f });
      });
    });
    rows.filter((f) => f.is_prescription !== false).forEach((fax) => {
      if (!firstSeen.current.has(fax.mail_id)) firstSeen.current.set(fax.mail_id, now);
      if (scripts.some((s) => s.faxMailId === fax.mail_id)) return;
      // Wait up to 90 s for the agent to look the patient up in Kroll by date of birth (then the name is right from the start).
      if (!fax.kroll_patient && now - (firstSeen.current.get(fax.mail_id) ?? now) < 90000) return;
      scriptFor(fax, true);
    });
  }, [rows, scripts, scriptFor, tab, updatePatient, updatePrescriber, updateMedication, updateScript]);

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
          <Button size="sm" variant={tab === "new" && day === "today" ? "default" : "outline"} onClick={() => { setTab("new"); setDay("today"); }}>
            Today{todayCount != null ? ` (${todayCount})` : ""}
          </Button>
          <Button size="sm" variant={tab === "new" && day === "all" ? "default" : "outline"} onClick={() => { setTab("new"); setDay("all"); }}>
            All to do{newCount != null ? ` (${newCount})` : ""}
          </Button>
          <Button size="sm" variant={tab === "pushed" ? "default" : "outline"} onClick={() => setTab("pushed")}>
            Pushed to Kroll
          </Button>
        </div>
        {tab === "new" && rows.some((f) => f.is_prescription !== false) && (
          <Button size="sm" onClick={() => navigate(`/app/verify/${scriptFor(rows.find((f) => f.is_prescription !== false) ?? rows[0], true)}`)}>
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
                {fax.is_prescription === false ? (
                  <>
                    <p className="text-[15px] font-bold">
                      {{ refill_request: "Refill request", transfer: "Transfer request", other: "Other fax" }[fax.doc_type ?? "other"] ?? "Other fax"}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{fax.summary || "Not a new prescription. Open it in Kroll's Inbound Docs."}</p>
                  </>
                ) : (<>
                {(() => {
                  const kp = fax.kroll_patient;
                  const matched = kp && (kp.status === "exact" || kp.status === "corrected" || kp.status === "ambiguous") && kp.last;
                  return (
                    <>
                      <p className="text-[15px] font-bold">
                        {matched ? `${kp.first} ${kp.last}` : s?.patient?.full_name || "Patient not readable"}
                        {s?.patient?.dob ? <span className="ml-2 font-data text-xs font-normal text-muted-foreground">{s.patient.dob}</span> : null}
                        {matched && kp.status !== "ambiguous" ? (
                          <Badge variant={kp.status === "corrected" ? "warning" : "outline"} className="ml-2 align-middle" title="Name taken from Kroll, found by date of birth">
                            {kp.status === "corrected" ? `Kroll name · matched by ${kp.matched_by && kp.matched_by !== "dob" ? kp.matched_by : "DOB"}` : "In Kroll"}
                          </Badge>
                        ) : null}
                        {kp?.status === "ambiguous" ? (
                          <Badge variant="warning" className="ml-2 align-middle" title="Several Kroll patients share this date of birth">
                            {kp.n_dob} in Kroll with this DOB
                          </Badge>
                        ) : null}
                        {kp?.status === "none" ? (
                          <Badge variant="warning" className="ml-2 align-middle" title="No patient in Kroll has this date of birth">
                            Not found in Kroll
                          </Badge>
                        ) : null}
                      </p>
                      {matched && kp.status === "corrected" && s?.patient?.full_name ? (
                        <p className="font-data text-[11px] text-muted-foreground">Fax says: {s.patient.full_name}</p>
                      ) : null}
                    </>
                  );
                })()}
                <p className="mt-0.5 text-sm">
                  {[m?.drug_name, m?.strength].filter(Boolean).join(" ") || "Drug not readable"}
                  <span className="text-muted-foreground"> · qty {m?.quantity ?? "?"} · refills {m?.refills ?? "?"}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {m?.sig || "no sig"} · Dr {s?.prescriber?.name || "?"}
                  {(s?.medications?.length ?? 0) > 1 ? ` · +${(s?.medications?.length ?? 1) - 1} more medication${(s?.medications?.length ?? 0) > 2 ? "s" : ""}` : ""}
                </p>
                </>)}
                {(() => {
                  const en = fax.kroll_enrich;
                  if (!en) return null;
                  const bits = [
                    en.doctor?.status === "found" || en.doctor?.status === "by_name" || en.doctor?.status === "by_address" ? `Dr ${en.doctor.first} ${en.doctor.last} in Kroll${en.doctor.status === "by_name" ? " (by name)" : en.doctor.status === "by_address" ? " (by clinic phone/address)" : ""}` : en.doctor?.status === "several" ? "Several matching doctors" : "Doctor not found in Kroll",
                    en.drug?.pick ? `DIN ${en.drug.pick} (${en.drug.reason})` : en.drug?.candidates?.length ? `${en.drug.candidates.length} products to pick from` : null,
                    en.last_rx ? `last Rx: ${en.last_rx.sig ?? "?"} · qty ${en.last_rx.qty ?? "?"}` : null,
                  ].filter(Boolean);
                  return <p className="font-data text-[11px] text-muted-foreground">Kroll says: {bits.join(" · ")}</p>;
                })()}
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
                    {fax.is_prescription !== false && (
                      <Button size="sm" onClick={() => navigate(`/app/verify/${scriptFor(fax, false)}`)}>
                        <Printer className="h-4 w-4" /> Review &amp; push
                      </Button>
                    )}
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
            {tab === "new" ? (day === "today" ? "No prescription faxes today yet. Older ones are under All to do." : "No new prescription faxes. They appear here by themselves.") : "Nothing pushed yet."}
          </li>
        )}
      </ul>
    </div>
  );
}
