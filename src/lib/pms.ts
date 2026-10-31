import type { Medication, PmsId, Script } from "@/lib/types";

export interface PmsProfile {
  id: PmsId;
  name: string;
  vendor: string;
  shortcut: string;
  /** Tailwind accent classes for the target chip. */
  accent: string;
  /** Human readable field-entry order for the keystroke plan preview. */
  entryOrder: string[];
}

export const PMS_PROFILES: PmsProfile[] = [
  {
    id: "kroll",
    name: "TELUS Kroll",
    vendor: "TELUS Health",
    shortcut: "Ctrl + Shift + V",
    accent: "text-sky-700 bg-sky-50 border-sky-200",
    entryOrder: [
      "Patient search window",
      "Health card + DOB",
      "Prescriber lookup",
      "Drug / DIN entry",
      "Sig instructions",
      "Quantity & refills",
      "Confirm & print label",
    ],
  },
  {
    id: "propelrx",
    name: "McKesson Propel Rx",
    vendor: "McKesson Canada",
    shortcut: "Ctrl + Shift + P",
    accent: "text-violet-700 bg-violet-50 border-violet-200",
    entryOrder: [
      "New Rx tab",
      "Patient demographics",
      "Prescriber selection",
      "Product search (DIN)",
      "Directions field",
      "Dispense quantity",
      "Save & queue label",
    ],
  },
  {
    id: "winrx",
    name: "WinRx / Nexsys",
    vendor: "Nexsys / Emergis",
    shortcut: "Alt + Insert",
    accent: "text-emerald-700 bg-emerald-50 border-emerald-200",
    entryOrder: [
      "Prescription entry grid",
      "Client record",
      "Doctor record",
      "Drug code field",
      "Sig field",
      "Qty / refills",
      "Post to profile",
    ],
  },
];

export function getPmsProfile(id: PmsId): PmsProfile {
  return PMS_PROFILES.find((profile) => profile.id === id) ?? PMS_PROFILES[0];
}

export interface KeystrokeStep {
  id: string;
  label: string;
  value: string;
  keys: string;
}

/**
 * Builds the ordered keystroke plan the desktop helper replays into the target
 * Pharmacy Management System window.
 */
export function buildKeystrokePlan(script: Script, pms: PmsProfile): KeystrokeStep[] {
  const steps: KeystrokeStep[] = [
    { id: "focus", label: "Focus window", value: pms.name, keys: `${pms.shortcut} → FOCUS` },
    { id: "patient", label: "Patient name", value: script.patient.full_name, keys: "patient field" },
    { id: "dob", label: "Date of birth", value: script.patient.dob, keys: "tab → dob" },
    { id: "hcn", label: "Health card", value: script.patient.health_card_num, keys: "tab → health card" },
    {
      id: "prescriber",
      label: "Prescriber",
      value: `${script.prescriber.name} (${script.prescriber.license_number || "NO LICENCE"})`,
      keys: "prescriber lookup",
    },
  ];

  script.medications.forEach((med: Medication, index: number) => {
    const prefix = `med-${index}`;
    steps.push({
      id: `${prefix}-din`,
      label: `Drug ${index + 1} — DIN`,
      value: med.is_compound ? "COMPOUND (manual build)" : med.din || "NO DIN",
      keys: "product search field",
    });
    steps.push({
      id: `${prefix}-name`,
      label: `Drug ${index + 1} — product`,
      value: `${med.drug_name} ${med.strength}`.trim(),
      keys: "autocomplete selection",
    });
    steps.push({
      id: `${prefix}-sig`,
      label: `Drug ${index + 1} — sig`,
      value: med.sig,
      keys: "directions field",
    });
    steps.push({
      id: `${prefix}-qty`,
      label: `Drug ${index + 1} — qty / refills`,
      value: `${med.quantity} / ${med.refills}`,
      keys: "qty → refills",
    });
  });

  steps.push({ id: "commit", label: "Commit", value: "Save to patient profile", keys: "Ctrl + S" });
  return steps;
}
