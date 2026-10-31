import { AlertTriangle, Info, Plus, Trash2 } from "lucide-react";

import { LevelIcon, ScoreChip } from "@/components/Confidence";
import { ConfidenceField } from "@/components/ConfidenceField";
import { MedicationCard } from "@/components/MedicationCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { LEVEL_STYLES, fieldLevel, scriptIssues, scriptLevel, STATUS_STYLES } from "@/lib/confidence";
import { DIN_STATUS_META } from "@/services/dpd";
import { cn } from "@/lib/utils";
import type { Script } from "@/lib/types";
import { useAppStore } from "@/store/app-store";

export function ScriptWorkspace({
  script,
  activeField,
  onFocusField,
}: {
  script: Script;
  activeField?: string;
  onFocusField: (key: string) => void;
}) {
  const { updatePatient, updatePrescriber, updateScript, addMedication, removeMedication } = useAppStore();

  const level = scriptLevel(script);
  const issues = scriptIssues(script);
  const statusMeta = STATUS_STYLES[script.status];

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("gap-1.5", statusMeta.chip)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dot)} />
          {statusMeta.label}
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <LevelIcon level={level} className="h-3 w-3" />
          Overall {Math.round(script.overallConfidence * 100)}%
        </Badge>
        {script.illegible ? (
          <Badge variant="destructive" className="gap-1.5">
            <AlertTriangle className="h-3 w-3" />
            Illegible handwriting
          </Badge>
        ) : null}
        {script.medications.some((med) => med.din_status === "compound") ? (
          <Badge variant="violet">Custom compound</Badge>
        ) : null}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {script.documentName} · page {script.pageNumber}
          {script.totalOnPage > 1 ? ` · script ${script.indexOnPage + 1} of ${script.totalOnPage}` : ""}
        </span>
      </div>

      {issues.length ? (
        <div className={cn("rounded-lg border p-3", LEVEL_STYLES[level].border, "border border-l-4 bg-card")}>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Info className="h-3.5 w-3.5" />
            {issues.length} item{issues.length === 1 ? "" : "s"} to confirm before pushing
          </p>
          <ul className="mt-1.5 space-y-1">
            {issues.map((issue) => (
              <li key={issue} className="text-[11px] text-muted-foreground">
                • {issue}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Patient</h3>
          <Separator className="flex-1" />
        </div>
        <div className="grid gap-3">
          <ConfidenceField
            label="Full name"
            value={script.patient.full_name}
            score={script.patient.field_scores.full_name ?? script.patient.confidence}
            level={fieldLevel(script.patient.confidence)}
            active={activeField === "patient.full_name"}
            onFocus={() => onFocusField("patient.full_name")}
            onChange={(value) => updatePatient(script.id, { full_name: value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ConfidenceField
              label="Date of birth"
              value={script.patient.dob}
              score={script.patient.field_scores.dob ?? script.patient.confidence}
              level={fieldLevel(script.patient.confidence)}
              active={activeField === "patient.full_name"}
              onFocus={() => onFocusField("patient.full_name")}
              onChange={(value) => updatePatient(script.id, { dob: value })}
            />
            <ConfidenceField
              label="Health card / provincial ID"
              value={script.patient.health_card_num}
              score={script.patient.field_scores.health_card_num ?? script.patient.confidence}
              level={fieldLevel(script.patient.confidence)}
              active={activeField === "patient.full_name"}
              onFocus={() => onFocusField("patient.full_name")}
              onChange={(value) => updatePatient(script.id, { health_card_num: value })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prescriber</h3>
          <Separator className="flex-1" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ConfidenceField
            label="Prescriber name"
            value={script.prescriber.name}
            score={script.prescriber.field_scores.name ?? script.prescriber.confidence}
            level={fieldLevel(script.prescriber.confidence)}
            active={activeField === "prescriber.name"}
            onFocus={() => onFocusField("prescriber.name")}
            onChange={(value) => updatePrescriber(script.id, { name: value })}
          />
          <ConfidenceField
            label="Licence number (CPSO / provincial)"
            value={script.prescriber.license_number}
            score={script.prescriber.field_scores.license_number ?? script.prescriber.confidence}
            level={fieldLevel(script.prescriber.confidence, {
              requiresCheck: !script.prescriber.license_number.trim(),
            })}
            active={activeField === "prescriber.name"}
            onFocus={() => onFocusField("prescriber.name")}
            onChange={(value) => updatePrescriber(script.id, { license_number: value })}
            hint={
              script.prescriber.license_number.trim()
                ? undefined
                : "Missing — confirm against the provincial register before dispensing"
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Medications ({script.medications.length})
          </h3>
          <Separator className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => addMedication(script.id)}>
            <Plus className="h-3.5 w-3.5" />
            Add row
          </Button>
        </div>

        <div className="space-y-3">
          {script.medications.map((medication, index) => (
            <div key={medication.id} className="relative">
              <MedicationCard
                script={script}
                medication={medication}
                index={index}
                activeField={activeField}
                onFocusField={onFocusField}
              />
              {script.medications.length > 1 ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute -right-1 -top-1 bg-card text-muted-foreground shadow-sm ring-1 ring-border hover:text-destructive"
                  onClick={() => removeMedication(script.id, medication.id)}
                  title="Remove this medication"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Technician notes
          </h3>
          <Separator className="flex-1" />
        </div>
        <Label className="sr-only" htmlFor="script-notes">
          Technician notes
        </Label>
        <Textarea
          id="script-notes"
          value={script.notes}
          placeholder="Clarifications, prescriber call-backs, delivery instructions…"
          onChange={(event) => updateScript(script.id, { notes: event.target.value })}
        />
      </section>

      <div className="rounded-lg border border-border bg-secondary/40 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          DIN cross-reference
        </p>
        <div className="mt-2 space-y-1.5">
          {script.medications.map((medication, index) => (
            <div key={medication.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-foreground">#{index + 1}</span>
              <span className="font-mono text-muted-foreground">{medication.din || "—"}</span>
              <Badge variant="outline" className={cn("gap-1", DIN_STATUS_META[medication.din_status].chip)}>
                {DIN_STATUS_META[medication.din_status].label}
              </Badge>
              <span className="truncate text-muted-foreground">{medication.din_product ?? ""}</span>
              <ScoreChip
                level={medication.confidence >= 0.9 ? "high" : medication.confidence >= 0.7 ? "medium" : "low"}
                score={medication.confidence}
                className="ml-auto"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
