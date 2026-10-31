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
export interface HelperPayload {
  target_system: string;
  data: {
    patient_lookup: string;
    prescriber_license: string;
    din_code: string;
    quantity: string;
    sig_text: string;
  };
}

export function buildHelperPayload(script: Script, medIndex: number, pmsId: PmsId): HelperPayload {
  const medication = script.medications[medIndex];
  return {
    target_system: getPmsProfile(pmsId).targetSystem,
    data: {
      patient_lookup: script.patient.health_card_num,
      prescriber_license: script.prescriber.license_number,
      din_code: medication?.is_compound ? "" : medication?.din ?? "",
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
