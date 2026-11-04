import type { ConfidenceLevel, Medication, Script } from "./types";

export interface ConfidenceThresholds {
  high: number;
  medium: number;
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = { high: 0.9, medium: 0.7 };

export function levelForScore(score: number, t: ConfidenceThresholds = DEFAULT_THRESHOLDS): ConfidenceLevel {
  if (score >= t.high) return "high";
  if (score >= t.medium) return "medium";
  return "low";
}

export interface LevelStyle {
  label: string;
  dot: string;
  chip: string;
  border: string;
  ring: string;
  text: string;
  soft: string;
  hex: string;
}

export const LEVEL_STYLES: Record<ConfidenceLevel, LevelStyle> = {
  high: {
    label: "High confidence",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
    border: "border-l-emerald-500",
    ring: "ring-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
    soft: "bg-emerald-50 dark:bg-emerald-950/40",
    hex: "#10b981",
  },
  medium: {
    label: "Needs a quick check",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
    border: "border-l-amber-500",
    ring: "ring-amber-400",
    text: "text-amber-600 dark:text-amber-400",
    soft: "bg-amber-50 dark:bg-amber-950/40",
    hex: "#f59e0b",
  },
  low: {
    label: "Low confidence",
    dot: "bg-red-500",
    chip: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
    border: "border-l-red-500",
    ring: "ring-red-400",
    text: "text-red-600 dark:text-red-400",
    soft: "bg-red-50 dark:bg-red-950/40",
    hex: "#ef4444",
  },
};

export function fieldLevel(
  score: number,
  opts: { verified?: boolean; requiresCheck?: boolean } = {},
  t: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceLevel {
  let level = levelForScore(score, t);
  if (level === "high" && (opts.verified === false || opts.requiresCheck)) level = "medium";
  return level;
}

export function medicationLevel(
  med: Medication,
  t: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceLevel {
  const requiresCheck =
    med.din_status === "unverified" ||
    med.din_status === "invalid" ||
    !med.drug_name.trim() ||
    !med.strength.trim();
  return fieldLevel(med.confidence, { verified: !requiresCheck, requiresCheck: med.is_compound }, t);
}

export function medicationIssues(med: Medication): string[] {
  const issues: string[] = [];
  if (med.is_compound) issues.push("Custom compound — no DIN on file");
  if (!med.drug_name.trim()) issues.push("Drug name missing");
  if (!med.strength.trim()) issues.push("Strength missing");
  if (med.din_status === "unverified" && med.din)
    issues.push(`DIN ${med.din} not found in Health Canada DPD extract`);
  if (med.din_status === "invalid") issues.push(`DIN ${med.din} fails the 8-digit check digit`);
  if (!med.din && !med.is_compound) issues.push("No DIN captured");
  if (med.quantity <= 0) issues.push("Quantity missing or zero");
  if (!med.sig.trim()) issues.push("Sig / directions missing");
  if (med.confidence < 0.7) issues.push("Low-confidence drug entry");
  return issues;
}

export function scriptLevel(script: Script, t: ConfidenceThresholds = DEFAULT_THRESHOLDS): ConfidenceLevel {
  if (script.illegible) return "low";
  let level = levelForScore(script.overallConfidence, t);
  const hasMedicationFlag = script.medications.some(
    (m) =>
      m.din_status === "unverified" ||
      m.din_status === "invalid" ||
      m.is_compound ||
      !m.drug_name.trim() ||
      !m.strength.trim(),
  );
  const missingLicence = !script.prescriber.license_number.trim();
  const missingHealthCard = !script.patient.health_card_num.trim();
  if (level === "high" && (hasMedicationFlag || missingLicence || missingHealthCard)) level = "medium";
  return level;
}

export function scriptIssues(script: Script): string[] {
  const issues: string[] = [...script.flags];
  if (script.illegible) issues.push("Illegible handwriting flagged by Vision AI");
  if (!script.prescriber.license_number.trim()) issues.push("Prescriber licence number missing");
  if (!script.patient.health_card_num.trim()) issues.push("Health card / provincial ID missing");
  if (!script.patient.full_name.trim()) issues.push("Patient name missing");
  if (script.patient.confidence < 0.7) issues.push("Patient identity below 70% confidence");
  script.medications.forEach((med) => {
    medicationIssues(med).forEach((issue) => issues.push(issue));
  });
  return Array.from(new Set(issues));
}

export function formatPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export const STATUS_STYLES: Record<Script["status"], { label: string; chip: string; dot: string }> = {
  pending: {
    label: "Pending",
    chip: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    dot: "bg-slate-400",
  },
  verified: {
    label: "Verified",
    chip: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
    dot: "bg-sky-500",
  },
  pushed: {
    label: "Pushed",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
    dot: "bg-emerald-500",
  },
};
