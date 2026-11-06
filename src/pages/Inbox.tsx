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

  async function setStatus(row: InboxRow, status: RowStatus) {
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ id: row.id, status }),
    });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
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
              <InboxIcon className="h-4 w-4" /> Kroll inbox
            </CardTitle>
            <CardDescription>
              Live Kroll SQL + ScriptImage OCR when available. Load into Verify for side-by-side image and fields.
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
