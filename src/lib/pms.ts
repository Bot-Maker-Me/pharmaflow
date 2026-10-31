import type { PmsId, Script } from "@/lib/types";

export interface PmsProfile {
  id: PmsId;
  name: string;
  shortName: string;
  vendor: string;
  /** Value placed in the `target_system` field of the helper payload. */
  targetSystem: "KROLL" | "PROPELRX" | "WINRX";
  /** Global hotkey the technician can use to trigger a push. */
  shortcut: string;
  /** Tailwind accent classes for the target chip. */
  accent: string;
  /** Key sequence used by the desktop helper driver. */
  keyMap: { patient: string; prescriber: string; drug: string };
  entryOrder: string[];
}

export const PMS_PROFILES: PmsProfile[] = [
  {
    id: "kroll",
    name: "TELUS Kroll",
    shortName: "Kroll",
    vendor: "TELUS Health",
    targetSystem: "KROLL",
    shortcut: "Ctrl + Shift + V",
    accent:
      "text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-950/50 dark:border-sky-900",
    keyMap: { patient: "F3", prescriber: "F7", drug: "F5" },
    entryOrder: [
      "Patient lookup (F3)",
      "Prescriber lookup (F7)",
      "Drug / DIN entry (F5)",
      "Sig instructions",
      "Quantity",
    ],
  },
  {
    id: "propelrx",
    name: "McKesson Propel Rx",
    shortName: "Propel Rx",
    vendor: "McKesson Canada",
    targetSystem: "PROPELRX",
    shortcut: "Ctrl + Shift + P",
    accent:
      "text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/50 dark:border-violet-900",
    keyMap: { patient: "Ctrl+F", prescriber: "F2", drug: "F6" },
    entryOrder: [
      "New Rx tab (Ctrl+N)",
      "Patient search (Ctrl+F)",
      "Prescriber (F2)",
      "Product search (F6)",
      "Sig & quantity",
    ],
  },
  {
    id: "winrx",
    name: "WinRx / Nexsys",
    shortName: "WinRx",
    vendor: "Nexsys / Emergis",
    targetSystem: "WINRX",
    shortcut: "Alt + Insert",
    accent:
      "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/50 dark:border-emerald-900",
    keyMap: { patient: "Alt+C", prescriber: "Alt+D", drug: "Alt+P" },
    entryOrder: [
      "Client record (Alt+C)",
      "Doctor record (Alt+D)",
      "Drug code (Alt+P)",
      "Sig field",
      "Quantity",
    ],
  },
];

export function getPmsProfile(id: PmsId): PmsProfile {
  return PMS_PROFILES.find((profile) => profile.id === id) ?? PMS_PROFILES[0];
}

export interface KeystrokeStep {
  id: string;
  /** Index of the medication this step belongs to, or -1 for session steps. */
  medicationIndex: number;
  label: string;
  value: string;
  keys: string;
}

/**
 * Mirrors the exact keystroke order the desktop helper replays for each
 * medication, so the trace shown in the UI matches what happens on screen.
 */
export function buildKeystrokePlan(script: Script, profile: PmsProfile): KeystrokeStep[] {
  const steps: KeystrokeStep[] = [
    {
      id: "focus",
      medicationIndex: -1,
      label: "Focus PMS window",
      value: profile.name,
      keys: `${profile.shortcut} → FOCUS`,
    },
  ];

  script.medications.forEach((medication, index) => {
    steps.push({
      id: `med-${index}-patient`,
      medicationIndex: index,
      label: `Drug ${index + 1} · patient lookup`,
      value: script.patient.health_card_num,
      keys: profile.keyMap.patient,
    });
    steps.push({
      id: `med-${index}-prescriber`,
      medicationIndex: index,
      label: `Drug ${index + 1} · prescriber`,
      value: `${script.prescriber.name} (${script.prescriber.license_number || "NO LICENCE"})`,
      keys: profile.keyMap.prescriber,
    });
    steps.push({
      id: `med-${index}-din`,
      medicationIndex: index,
      label: `Drug ${index + 1} · DIN`,
      value: medication.is_compound ? "compound — skipped" : medication.din || "no DIN",
      keys: medication.is_compound ? "SKIP" : profile.keyMap.drug,
    });
    steps.push({
      id: `med-${index}-sig`,
      medicationIndex: index,
      label: `Drug ${index + 1} · sig`,
      value: medication.sig,
      keys: "Ctrl + V",
    });
    steps.push({
      id: `med-${index}-qty`,
      medicationIndex: index,
      label: `Drug ${index + 1} · quantity`,
      value: String(medication.quantity),
      keys: "Tab → typewrite",
    });
  });

  return steps;
}
