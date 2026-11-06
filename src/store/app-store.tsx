import * as React from "react";
import { toast } from "sonner";

import { enrichMedicationFromDin } from "@/services/dpd";
import {
  diffScriptAgainstSnapshot,
  refreshLearnedMappings,
  snapshotFromScript,
  submitCorrections,
} from "@/services/learn";
import { LocalHelperClient, type HelperInfo, type HelperStatus, type PushOutcome } from "@/services/agent";
import { createSampleDocument, uid } from "@/services/mockVision";
import { countPdfPages } from "@/services/pdf";
import { requestExtraction } from "@/services/vision";
import type { KeystrokeStep } from "@/lib/pms";
import {
  DEFAULT_SETTINGS,
  type Medication,
  type Patient,
  type PipelineState,
  type PmsId,
  type Prescriber,
  type ProcessedDocument,
  type Script,
  type Settings,
} from "@/lib/types";

const SETTINGS_KEY = "pharmflow.settings.v1";

export interface ActivityEntry {
  id: string;
  at: string;
  text: string;
  tone: "info" | "ok" | "warn";
}

export interface ManualScriptInput {
  full_name: string;
  dob: string;
  health_card_num: string;
  prescriber_name: string;
  license_number: string;
  drug_name: string;
  din: string;
  strength: string;
  quantity: number;
  refills: number;
  sig: string;
  is_compound: boolean;
  source?: "manual" | "kroll_sql" | "fax";
  pending_rx_id?: number;
  drug_id?: string;
  store_id?: string;
  page_image_url?: string;
}

interface AppStoreValue {
  documents: ProcessedDocument[];
  scripts: Script[];
  settings: Settings;
  pipeline: PipelineState;
  helperStatus: HelperStatus;
  helperInfo: HelperInfo;
  activity: ActivityEntry[];
  stats: {
    pending: number;
    verified: number;
    pushed: number;
    flagged: number;
    total: number;
    averageConfidence: number;
  };
  documentById: (id: string) => ProcessedDocument | undefined;
  scriptById: (id: string) => Script | undefined;
  updateSettings: (patch: Partial<Settings>) => void;
  ingestFiles: (files: File[]) => Promise<void>;
  loadSampleFax: () => void;
  updatePatient: (scriptId: string, patch: Partial<Patient>) => void;
  updatePrescriber: (scriptId: string, patch: Partial<Prescriber>) => void;
  updateScript: (scriptId: string, patch: Partial<Script>) => void;
  updateMedication: (scriptId: string, medId: string, patch: Partial<Medication>) => void;
  addMedication: (scriptId: string) => void;
  removeMedication: (scriptId: string, medId: string) => void;
  reverifyDin: (scriptId: string, medId: string) => void;
  verifyScript: (scriptId: string) => void;
  pushScript: (
    scriptId: string,
    onStep: (step: KeystrokeStep, index: number, total: number) => void,
  ) => Promise<PushOutcome>;
  createManualScript: (input: ManualScriptInput) => string;
  checkHelper: () => Promise<void>;
  resetQueue: () => void;
}

const AppStoreContext = React.createContext<AppStoreValue | null>(null);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const merged = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
    if (merged.apiBaseUrl === "http://localhost:8000") merged.apiBaseUrl = "";
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function krollSqlPreviewSvg(input: ManualScriptInput): string {
  const esc = (s: string) =>
    String(s ?? "")
      .replace(/&/g, "&")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, """);
  const lines: Array<[string, string]> = [
    ["SOURCE", "Kroll PendingNewRx (SQL agent)"],
    ["PENDING RX", input.pending_rx_id != null ? String(input.pending_rx_id) : "—"],
    ["PATIENT", input.full_name || "—"],
    ["DOB", input.dob || "—"],
    ["PRESCRIBER", input.prescriber_name || "—"],
    ["LICENCE", input.license_number || "—"],
    ["DRUG ID", input.drug_id || input.drug_name || "—"],
    ["DIN", input.din || "(not on pending row — fill from fax/DPD)"],
    ["STRENGTH", input.strength || "(fill if known)"],
    ["QTY", String(input.quantity || "—")],
    ["REFILLS", String(input.refills ?? "—")],
    ["SIG", input.sig || "—"],
  ];
  const rows = lines
    .map(
      ([k, v], i) =>
        `<text x="36" y="${110 + i * 36}" font-family="ui-monospace,monospace" font-size="13" fill="#94a3b8">${esc(k)}</text>` +
        `<text x="200" y="${110 + i * 36}" font-family="ui-sans-serif,system-ui" font-size="15" fill="#f8fafc">${esc(v).slice(0, 48)}</text>`,
    )
    .join("");
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="560" viewBox="0 0 700 560">` +
    `<rect width="700" height="560" fill="#0f172a"/>` +
    `<rect x="20" y="20" width="660" height="520" rx="12" fill="#1e293b" stroke="#334155"/>` +
    `<text x="36" y="56" font-family="ui-sans-serif,system-ui" font-size="18" font-weight="700" fill="#22d3ee">KROLL SQL SNAPSHOT</text>` +
    `<text x="36" y="80" font-family="ui-sans-serif,system-ui" font-size="12" fill="#64748b">Live agent data · complete missing fields from the original fax</text>` +
    rows +
    `<text x="36" y="530" font-family="ui-sans-serif,system-ui" font-size="11" fill="#475569">Pipeline A (SQL) · Pipeline B (fax OCR) merges when a fax image is attached</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* __CHUNK_1__ */
