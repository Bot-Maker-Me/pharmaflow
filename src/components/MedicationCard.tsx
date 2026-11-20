import * as React from "react";
import { BadgeCheck, FlaskConical, Loader2, RefreshCw, Search, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfidenceField } from "@/components/ConfidenceField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { medicationIssues, medicationLevel } from "@/lib/confidence";
import { toPmsSig } from "@/lib/sig";
import { DIN_STATUS_META } from "@/services/dpd";
import { cn } from "@/lib/utils";
import type { DinCandidate, Medication, Script } from "@/lib/types";
import { useAppStore } from "@/store/app-store";

const DIN_SOURCE_LABEL: Record<string, string> = {
  fax: "Read from the fax",
  kroll_drug_record: "From the drug on the Kroll Rx",
  kroll_sql: "From Kroll's drug table (most dispensed)",
  dpd_unique_match: "Only marketed match in Health Canada DPD",
  staff_selected: "Chosen by staff",
};

const DIN_ICON = {
  verified: BadgeCheck,
  unverified: ShieldAlert,
  invalid: ShieldAlert,
  compound: FlaskConical,
} as const;

export function MedicationCard({
  script,
  medication,
  index,
  activeField,
  onFocusField,
}: {
  script: Script;
  medication: Medication;
  index: number;
  activeField?: string;
  onFocusField: (key: string) => void;
}) {
  const { updateMedication, reverifyDin, settings } = useAppStore();
  const [finding, setFinding] = React.useState(false);
  const focusKey = `med.${medication.id}`;
  const level = medicationLevel(medication);
  const issues = medicationIssues(medication);
  const statusMeta = DIN_STATUS_META[medication.din_status];
  const StatusIcon = DIN_ICON[medication.din_status];

  const patch = (changes: Partial<Medication>) => updateMedication(script.id, medication.id, changes);

  async function findDin() {
    if (!settings.apiToken) {
      toast.error("Set the API access token in Settings first.");
      return;
    }
    setFinding(true);
    try {
      const query = new URLSearchParams({ name: medication.drug_name, strength: medication.strength });
      const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, "")}/api/din-lookup?${query}`, {
        headers: { "x-access-token": settings.apiToken },
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Wrong API access token" : `Server returned ${response.status}`);
      const data = (await response.json()) as { candidates: DinCandidate[]; unique_din: string | null };
      if (!data.candidates.length) {
        toast.message("No marketed Health Canada product matches. Enter the DIN manually.");
        return;
      }
      patch({
        din_candidates: data.candidates,
        ...(data.unique_din && !medication.din ? { din: data.unique_din, din_source: "dpd_unique_match" } : {}),
      });
      toast.success(
        data.unique_din ? "One marketed match found. Please confirm it." : `${data.candidates.length} possible DINs. Pick one below.`,
      );
    } catch (error) {
      toast.error(`DIN lookup failed: ${(error as Error).message}`);
    } finally {
      setFinding(false);
    }
  }

  function pickDin(candidate: DinCandidate) {
    patch({ din: candidate.din, din_source: "staff_selected" });
    reverifyDin(script.id, medication.id);
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Medication {index + 1}
        </span>
        <Badge variant="outline" className={cn("gap-1", statusMeta.chip)}>
          <StatusIcon className="h-3 w-3" />
          {statusMeta.label}
        </Badge>
        {medication.is_compound ? (
          <Badge variant="violet" className="gap-1">
            <FlaskConical className="h-3 w-3" />
            IS_COMPOUND
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {!medication.is_compound && !medication.din ? (
            <Button variant="outline" size="sm" onClick={() => void findDin()} disabled={finding || !medication.drug_name} title="Search Health Canada DPD for the DIN">
              {finding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Find DIN
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => reverifyDin(script.id, medication.id)}
            title="Re-run the DPD cross-reference"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Verify DIN
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() =>
              patch({ drug_name: "", din: "", strength: "", sig: "", quantity: 0, refills: 0 })
            }
            title="Clear this medication row"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ConfidenceField
          className="sm:col-span-2"
          label="Drug name"
          value={medication.drug_name}
          score={medication.field_scores.drug_name ?? medication.confidence}
          level={level}
          active={activeField === focusKey}
          onFocus={() => onFocusField(focusKey)}
          onChange={(value) => patch({ drug_name: value })}
          hint={medication.din_product}
        />
        <ConfidenceField
          label="DIN"
          value={medication.din}
          score={medication.field_scores.din ?? medication.confidence}
          level={level}
          active={activeField === focusKey}
          numeric
          onFocus={() => onFocusField(focusKey)}
          onChange={(value) => patch({ din: value.replace(/[^\d]/g, "").slice(0, 8) })}
          hint={
            medication.is_compound
              ? "Compound — keyed manually in the PMS"
              : medication.din_source && DIN_SOURCE_LABEL[medication.din_source] && medication.din_source !== "fax"
                ? `${DIN_SOURCE_LABEL[medication.din_source]}${medication.din_source === "staff_selected" ? "" : " — please confirm"}`
                : medication.din_status === "verified"
                  ? "Matched in Health Canada DPD"
                  : "Not found in the DPD extract"
          }
        />
        {medication.din_candidates?.length && !medication.is_compound ? (
          <div className="sm:col-span-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Possible DINs — click to use
            </p>
            <div className="flex flex-wrap gap-1.5">
              {medication.din_candidates.map((candidate) => (
                <button
                  key={candidate.din}
                  type="button"
                  onClick={() => pickDin(candidate)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-left text-[11px] transition-colors hover:bg-secondary",
                    candidate.din === medication.din ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40" : "border-border",
                  )}
                  title={[candidate.company, candidate.form, candidate.strength].filter(Boolean).join(" · ")}
                >
                  <span className="font-mono">{candidate.din}</span> {candidate.brand}
                  {candidate.uses ? <span className="text-muted-foreground"> · {candidate.uses}× dispensed</span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <ConfidenceField
          label="Strength"
          value={medication.strength}
          score={medication.field_scores.strength ?? medication.confidence}
          level={level}
          active={activeField === focusKey}
          onFocus={() => onFocusField(focusKey)}
          onChange={(value) => patch({ strength: value })}
        />
        <ConfidenceField
          label="Quantity"
          value={String(medication.quantity)}
          score={medication.field_scores.quantity ?? medication.confidence}
          level={level}
          active={activeField === focusKey}
          numeric
          onFocus={() => onFocusField(focusKey)}
          onChange={(value) => patch({ quantity: Number(value.replace(/[^\d]/g, "")) || 0 })}
        />
        <ConfidenceField
          label="Refills"
          value={String(medication.refills)}
          score={medication.field_scores.refills ?? medication.confidence}
          level={level}
          active={activeField === focusKey}
          numeric
          onFocus={() => onFocusField(focusKey)}
          onChange={(value) => patch({ refills: Number(value.replace(/[^\d]/g, "")) || 0 })}
        />
        <ConfidenceField
          className="sm:col-span-2"
          label="Sig / directions"
          value={medication.sig}
          score={medication.field_scores.sig ?? medication.confidence}
          level={level}
          multiline
          active={activeField === focusKey}
          onFocus={() => onFocusField(focusKey)}
          onChange={(value) => patch({ sig: value })}
          hint={
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="uppercase tracking-wide text-muted-foreground">Sent to PMS as</span>
              <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                {toPmsSig(medication.sig) || "—"}
              </span>
            </span>
          }
        />
      </div>

      {issues.length ? (
        <ul className="mt-3 space-y-1">
          {issues.map((issue) => (
            <li key={issue} className="flex items-start gap-1.5 text-[11px] text-amber-700">
              <ShieldAlert className="mt-px h-3 w-3 shrink-0" />
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
