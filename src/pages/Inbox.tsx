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
      const patient = [row.patient_first, row.patient_last].filter(Boolean).join(" ").trim();
      createManualScript({
        full_name: patient || "UNKNOWN PATIENT",
        dob: row.patient_dob ?? "",
        health_card_num: "",
        prescriber_name: [row.doctor_first, row.doctor_last].filter(Boolean).join(" ").trim(),
        license_number: row.doctor_licence ?? "",
        drug_name: row.drug_id ? `Kroll drug ${row.drug_id}` : "",
        din: "",
        strength: "",
        quantity: Number(row.qty) || 0,
        refills: Number(row.refills) || 0,
        sig: row.sig_text ?? "",
        is_compound: false,
      });
      await setStatus(row, "processing");
      toast.success("Loaded — fill the health card and DIN, then verify.");
      navigate("/app/verify");
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
              Prescriptions read from Kroll by flow.py. The health card and DIN are not in the pending table, so
              the pharmacist completes them in Verification before anything is typed into Kroll.
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
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Drug {row.drug_id ?? "?"} · qty {row.qty ?? "?"} · {row.sig_text ?? "no sig"} · Dr{" "}
                      {[row.doctor_first, row.doctor_last].filter(Boolean).join(" ") || "?"}
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
