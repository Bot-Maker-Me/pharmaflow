import { BadgeCheck, FlaskConical, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";

import { ConfidenceField } from "@/components/ConfidenceField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { medicationIssues, medicationLevel } from "@/lib/confidence";
import { DIN_STATUS_META } from "@/services/dpd";
import { cn } from "@/lib/utils";
import type { Medication, Script } from "@/lib/types";
import { useAppStore } from "@/store/app-store";

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
  const { updateMedication, reverifyDin } = useAppStore();
  const focusKey = `med.${medication.id}`;
  const level = medicationLevel(medication);
  const issues = medicationIssues(medication);
  const statusMeta = DIN_STATUS_META[medication.din_status];
  const StatusIcon = DIN_ICON[medication.din_status];

  const patch = (changes: Partial<Medication>) => updateMedication(script.id, medication.id, changes);

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
              : medication.din_status === "verified"
                ? "Matched in Health Canada DPD"
                : "Not found in the DPD extract"
          }
        />
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
