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
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    border: "border-l-emerald-500",
    ring: "ring-emerald-400",
    text: "text-emerald-600",
    soft: "bg-emerald-50",
    hex: "#10b981",
  },
  medium: {
    label: "Needs a quick check",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    border: "border-l-amber-500",
    ring: "ring-amber-400",
    text: "text-amber-600",
    soft: "bg-amber-50",
    hex: "#f59e0b",
  },
  low: {
    label: "Low confidence",
    dot: "bg-red-500",
    chip: "bg-red-50 text-red-700 border-red-200",
    border: "border-l-red-500",
    ring: "ring-red-400",
    text: "text-red-600",
    soft: "bg-red-50",
    hex: "#ef4444",
  },
};

/**
 * Field-level colouring. A field is downgraded when the Vision AI was
 * confident but the supporting reference data (DIN / licence) could not be
 * verified — the technician still needs to eyeball it.
 */
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
  const requiresCheck = med.din_status === "unverified" || med.din_status === "invalid";
  return fieldLevel(med.confidence, { verified: !requiresCheck, requiresCheck: med.is_compound }, t);
}

export function medicationIssues(med: Medication): string[] {
  const issues: string[] = [];
  if (med.is_compound) issues.push("Custom compound — no DIN on file");
  if (med.din_status === "unverified") issues.push(`DIN ${med.din} not found in Health Canada DPD`);
  if (med.din_status === "invalid") issues.push(`DIN ${med.din} fails the 8-digit check digit`);
  if (!med.din && !med.is_compound) issues.push("No DIN captured");
  if (med.confidence < 0.7) issues.push("Low-confidence drug entry");
  return issues;
}

export function scriptLevel(script: Script, t: ConfidenceThresholds = DEFAULT_THRESHOLDS): ConfidenceLevel {
  if (script.illegible) return "low";
  let level = levelForScore(script.overallConfidence, t);
  const hasMedicationFlag = script.medications.some(
    (m) => m.din_status === "unverified" || m.din_status === "invalid" || m.is_compound,
  );
  const missingLicence = !script.prescriber.license_number.trim();
  if (level === "high" && (hasMedicationFlag || missingLicence)) level = "medium";
  return level;
}

export function scriptIssues(script: Script): string[] {
  const issues: string[] = [...script.flags];
  if (script.illegible) issues.push("Illegible handwriting flagged by Vision AI");
  if (!script.prescriber.license_number.trim()) issues.push("Prescriber licence number missing");
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
  pending: { label: "Pending", chip: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400" },
  verified: { label: "Verified", chip: "bg-sky-50 text-sky-700 border-sky-200", dot: "bg-sky-500" },
  pushed: { label: "Pushed", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
};
