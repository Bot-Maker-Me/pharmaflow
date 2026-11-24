import type { PmsId, Script } from "@/lib/types";
import { getPmsProfile } from "./pms";
import { toPmsSig } from "./sig";

/**
 * Keystroke payload contract sent to the local helper on
 * `POST http://localhost:48120/autofill`.
 *
 * One payload is produced per medication, because a legacy PMS treats each drug
 * on a prescription as its own entry.
 */
export type KrollStep = "patient" | "doctor" | "drug" | "sig" | "qty";

export interface HelperPayload {
  target_system: string;
  step?: KrollStep;
  data: {
    patient_lookup: string;
    prescriber_license: string;
    din_code: string;
    drug_name: string;
    quantity: string;
    sig_text: string;
  };
}

/**
 * What staff would type into the PMS patient search. Health card when the fax has one,
 * otherwise "Last, First" from the printed name (faxes often have no health card).
 */
export function patientLookup(patient: Script["patient"]): string {
  const card = (patient.health_card_num ?? "").trim();
  if (card) return card;
  const name = (patient.full_name ?? "").replace(/\s+/g, " ").trim();
  if (!name) return "";
  if (name.includes(",")) {
    const [last, ...rest] = name.split(",");
    return `${last.trim()}, ${rest.join(" ").trim()}`.replace(/,\s*$/, "");
  }
  const parts = name.split(" ");
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${last}, ${parts.slice(0, -1).join(" ")}`;
}

export function buildHelperPayload(script: Script, medIndex: number, pmsId: PmsId): HelperPayload {
  const medication = script.medications[medIndex];
  return {
    target_system: getPmsProfile(pmsId).targetSystem,
    data: {
      patient_lookup: patientLookup(script.patient),
      prescriber_license: script.prescriber.license_number,
      din_code: medication?.is_compound ? "" : medication?.din ?? "",
      drug_name: [medication?.drug_name, medication?.strength].filter(Boolean).join(" ").trim(),
      quantity: String(medication?.quantity ?? ""),
      sig_text: toPmsSig(medication?.sig ?? ""),
    },
  };
}

export function buildHelperPayloads(script: Script, pmsId: PmsId): HelperPayload[] {
  return script.medications.map((_, index) => buildHelperPayload(script, index, pmsId));
}

export function payloadForMedication(
  script: Script,
  medIndex: number,
  pmsId: PmsId,
): HelperPayload["data"] {
  return buildHelperPayload(script, medIndex, pmsId).data;
}

/** One small Kroll step (guided entry): the helper types just this field. */
export function buildStepPayload(
  script: Script,
  medIndex: number,
  pmsId: PmsId,
  step: KrollStep,
): HelperPayload {
  return { ...buildHelperPayload(script, medIndex, pmsId), step };
}
