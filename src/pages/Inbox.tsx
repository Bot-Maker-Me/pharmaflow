import * as React from "react";
import { Inbox as InboxIcon, Loader2, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/store/app-store";

type RowStatus = "received" | "processing" | "done" | "error";

interface InboxRow {
  id: number;
  store_id: string;
  pending_rx_id: number;
  drug_id: string | null;
  qty: string | null;
  refills: string | null;
  sig_text: string | null;
  date_created: string | null;
  patient_first: string | null;
  patient_last: string | null;
  patient_dob: string | null;
  doctor_first: string | null;
  doctor_last: string | null;
  doctor_licence: string | null;
  status: RowStatus;
  received_at: string;
  page_image_url?: string | null;
  ocr_din?: string | null;
  ocr_drug_name?: string | null;
  ocr_strength?: string | null;
  ocr_health_card?: string | null;
  planned?: { ocr_merged?: Record<string, unknown> } | null;
}

const LOADED_KEY = "pf-loaded-faxes";

function readLoaded(): Set<number> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(LOADED_KEY) || "[]") as number[]);
  } catch {
    return new Set();
  }
}

function writeLoaded(ids: Set<number>) {
  try {
    window.localStorage.setItem(LOADED_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* storage unavailable: loading still works, it just cannot remember what was loaded */
  }
}

interface FaxMed {
  drug_name?: string;
  strength?: string;
  quantity?: number;
  refills?: number;
  sig?: string;
  din?: string;
  is_compound?: boolean;
}
interface FaxRow {
  mail_id: number;
  received_label: string | null;
  from_label: string | null;
  page_image_url: string | null;
  ocr: {
    scripts?: Array<{
      patient?: { full_name?: string; dob?: string; health_card_num?: string };
      prescriber?: { name?: string; license_number?: string };
      medications?: FaxMed[];
      overall_confidence?: number;
    }>;
  } | null;
}

const TABS: Array<{ id: RowStatus; label: string }> = [
  { id: "received", label: "New" },
  { id: "processing", label: "In progress" },
  { id: "done", label: "Done" },
  { id: "error", label: "Errors" },
];

export default function Inbox() {
  const { settings, createManualScript } = useAppStore();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<RowStatus>("received");
  const [rows, setRows] = React.useState<InboxRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [faxes, setFaxes] = React.useState<FaxRow[]>([]);
  const [loadedFaxes, setLoadedFaxes] = React.useState<Set<number>>(() => readLoaded());

  const endpoint = `${settings.apiBaseUrl.replace(/\/$/, "")}/api/queue`;
  const headers = React.useMemo(
    () => ({ "Content-Type": "application/json", "x-access-token": settings.apiToken }),
    [settings.apiToken],
  );

  const load = React.useCallback(async () => {
    if (!settings.apiToken) {
      toast.error("Set the API access token in Settings first.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${endpoint}?status=${tab}`, { headers });
      if (response.status === 401) throw new Error("Wrong API access token");
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = (await response.json()) as { rows: InboxRow[] };
      setRows(data.rows);
    } catch (error) {
      toast.error(`Could not load the inbox: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [endpoint, headers, settings.apiToken, tab]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Faxes the agent already read from Kroll's Inbound Docs (before staff fill them in).
  React.useEffect(() => {
    if (!settings.apiToken) return;
    let cancelled = false;
    const loadFaxes = async () => {
      try {
        const response = await fetch(`${endpoint}?kind=faxes`, { headers });
        if (!response.ok) return;
        const data = (await response.json()) as { rows: FaxRow[] };
        if (!cancelled) setFaxes(data.rows);
      } catch {
        /* try again next tick */
      }
    };
    void loadFaxes();
    const timer = window.setInterval(() => void loadFaxes(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [endpoint, headers, settings.apiToken]);

  // Live feed: poll the queue so faxes arriving on the Kroll server appear without pressing Refresh.
  const knownIds = React.useRef<Set<number> | null>(null);
  React.useEffect(() => {
    if (!settings.apiToken) return;
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`${endpoint}?status=${tab}`, { headers });
        if (!response.ok) return;
        const data = (await response.json()) as { rows: InboxRow[] };
        if (tab === "received") {
          const seen = knownIds.current;
          const fresh = seen ? data.rows.filter((row) => !seen.has(row.id)) : [];
          if (fresh.length) {
            toast.info(`${fresh.length} new fax${fresh.length > 1 ? "es" : ""} from Kroll`);
          }
          knownIds.current = new Set(data.rows.map((row) => row.id));
        }
        setRows(data.rows);
      } catch {
        /* transient network error: try again next tick */
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [endpoint, headers, settings.apiToken, tab]);

  React.useEffect(() => {
    if (tab === "received" && !knownIds.current && rows.length) knownIds.current = new Set(rows.map((row) => row.id));
  }, [rows, tab]);

  async function setStatus(row: InboxRow, status: RowStatus) {
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ id: row.id, status }),
    });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
  }

  /** Put one OCR-read fax into Intake / Verify with everything the agent found filled in. */
  function loadFax(fax: FaxRow, quiet: boolean): string {
    const script = fax.ocr?.scripts?.[0];
    const med = script?.medications?.[0];
    const id = createManualScript({
      full_name: script?.patient?.full_name || "UNKNOWN PATIENT",
      dob: script?.patient?.dob || "",
      health_card_num: script?.patient?.health_card_num || "",
      prescriber_name: script?.prescriber?.name || "",
      license_number: script?.prescriber?.license_number || "",
      drug_name: med?.drug_name || "",
      din: med?.din || "",
      strength: med?.strength || "",
      quantity: Number(med?.quantity) || 0,
      refills: Number(med?.refills) || 0,
      sig: med?.sig || "",
      is_compound: Boolean(med?.is_compound),
      source: "fax",
      page_image_url: fax.page_image_url || undefined,
      confidence: script?.overall_confidence,
      quiet,
    });
    setLoadedFaxes((prev) => {
      const next = new Set(prev).add(fax.mail_id);
      writeLoaded(next);
      return next;
    });
    return id;
  }

  const unloadedFaxes = faxes.filter((fax) => !loadedFaxes.has(fax.mail_id));

  function loadAllFaxes() {
    unloadedFaxes.forEach((fax) => loadFax(fax, true));
    toast.success(`${unloadedFaxes.length} fax${unloadedFaxes.length === 1 ? "" : "es"} loaded into Intake`);
    navigate("/app");
  }

  async function loadIntoVerify(row: InboxRow) {
    try {
      const merged = (row.planned as { ocr_merged?: any } | null | undefined)?.ocr_merged;
      const ocrPatient = merged?.patient || {};
      const ocrPrescriber = merged?.prescriber || {};
      const ocrMed = merged?.medications?.[0] || {};
      const patient =
        ocrPatient.full_name ||
        [row.patient_first, row.patient_last].filter(Boolean).join(" ").trim();
      const scriptId = createManualScript({
        full_name: patient || "UNKNOWN PATIENT",
        dob: ocrPatient.dob || row.patient_dob || "",
        health_card_num: ocrPatient.health_card_num || row.ocr_health_card || "",
        prescriber_name:
          ocrPrescriber.name ||
          [row.doctor_first, row.doctor_last].filter(Boolean).join(" ").trim(),
        license_number: ocrPrescriber.license_number || row.doctor_licence || "",
        drug_name:
          ocrMed.drug_name ||
          row.ocr_drug_name ||
          (row.drug_id ? `Kroll drug ${row.drug_id}` : ""),
        din: ocrMed.din || row.ocr_din || "",
        din_candidates: ocrMed.din_candidates,
        din_source: ocrMed.din_source,
        strength: ocrMed.strength || row.ocr_strength || "",
        quantity: Number(ocrMed.quantity) || Number(row.qty) || 0,
        refills: Number(ocrMed.refills) || Number(row.refills) || 0,
        sig: ocrMed.sig || row.sig_text || "",
        is_compound: Boolean(ocrMed.is_compound),
        source: "kroll_sql",
        pending_rx_id: row.pending_rx_id,
        drug_id: row.drug_id ?? undefined,
        store_id: row.store_id,
        page_image_url: row.page_image_url || undefined,
      });
      await setStatus(row, "processing");
      toast.success(
        row.page_image_url || merged
          ? "SQL + OCR loaded into Verify (image + fields)"
          : "SQL row loaded — no ScriptImage yet; fill DIN / health card",
      );
      navigate(`/app/verify/${scriptId}`);
    } catch (error) {
      toast.error(`Failed: ${(error as Error).message}`);
    }
  }

  async function finish(row: InboxRow, status: RowStatus) {
    try {
      await setStatus(row, status);
      setRows((prev) => prev.filter((candidate) => candidate.id !== row.id));
    } catch (error) {
      toast.error(`Failed: ${(error as Error).message}`);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 p-4 lg:p-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <InboxIcon className="h-4 w-4" /> Faxes read from Kroll Inbound Docs
            </CardTitle>
            <CardDescription>
              Prescription faxes the agent already read, before staff open them: what it found on the page. Ads and cover sheets are left out.
            </CardDescription>
          </div>
          {unloadedFaxes.length > 0 && (
            <Button size="sm" onClick={loadAllFaxes}>
              Load all {unloadedFaxes.length} into Intake
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {faxes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No prescription faxes read yet.</p>
          ) : (
            <ul className="divide-y divide-border border border-border">
              {faxes.map((fax) => {
                const script = fax.ocr?.scripts?.[0];
                const med = script?.medications?.[0];
                return (
                  <li key={fax.mail_id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {script?.patient?.full_name || "Patient not readable"}
                        {script?.patient?.dob ? <span className="ml-2 font-mono text-xs text-muted-foreground">{script.patient.dob}</span> : null}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">{fax.received_label ?? ""}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[med?.drug_name, med?.strength].filter(Boolean).join(" ") || "drug not readable"} · qty {med?.quantity ?? "?"} · refills{" "}
                        {med?.refills ?? "?"} · {med?.sig || "no sig"} · Dr {script?.prescriber?.name || "?"} · from {fax.from_label ?? "unknown"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {script?.overall_confidence != null && (
                        <Badge variant="outline">{Math.round(script.overall_confidence * 100)}%</Badge>
                      )}
                      {fax.page_image_url && (
                        <Button size="sm" variant="outline" asChild>
                          <a href={fax.page_image_url} target="_blank" rel="noreferrer">
                            View fax
                          </a>
                        </Button>
                      )}
                      {loadedFaxes.has(fax.mail_id) ? (
                        <Badge variant="secondary">In Intake</Badge>
                      ) : (
                        <Button size="sm" onClick={() => navigate(`/app/verify/${loadFax(fax, false)}`)}>
                          Load into Verify
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <InboxIcon className="h-4 w-4" /> Kroll inbox
            </CardTitle>
            <CardDescription>
              Live feed from the Kroll server (refreshes every 15 s): SQL + fax image OCR. Load into Verify for side-by-side image and fields.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="flex flex-wrap gap-2">
            {TABS.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={tab === item.id ? "default" : "outline"}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing here.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {[row.patient_first, row.patient_last].filter(Boolean).join(" ") || "Unknown patient"}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">Rx #{row.pending_rx_id}</span>
                      {row.page_image_url ? (
                        <Badge className="ml-2" variant="secondary">
                          OCR image
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.ocr_drug_name || `Drug ${row.drug_id ?? "?"}`} · DIN {row.ocr_din || "—"} · qty{" "}
                      {row.qty ?? "?"} · {row.sig_text ?? "no sig"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{row.status}</Badge>
                    {row.status === "received" && (
                      <Button size="sm" onClick={() => void loadIntoVerify(row)}>
                        Load into Verify
                      </Button>
                    )}
                    {row.status === "processing" && (
                      <>
                        <Button size="sm" onClick={() => void finish(row, "done")}>
                          Mark done
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void finish(row, "error")}>
                          Flag error
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
