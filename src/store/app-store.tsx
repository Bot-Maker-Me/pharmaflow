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
import { isTiffFile, tiffToPageUrls } from "@/services/tiff";
import type { KeystrokeStep } from "@/lib/pms";
import {
  DEFAULT_SETTINGS,
  type DinCandidate,
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
  din_candidates?: DinCandidate[];
  din_source?: string;
  /** Overall OCR confidence 0..1 (faxes read by the agent). */
  confidence?: number;
  /** Skip the "loaded" toast (bulk loading). */
  quiet?: boolean;
  /** Kroll dbo.Mail id of the inbound fax this script was read from. */
  fax_mail_id?: number;
  /** Extra "please check" lines shown on the review screen. */
  extra_flags?: string[];
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

const LIVE_DEFAULT_FLAG = "pharmflow.live-default.v1";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const merged = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
    if (merged.apiBaseUrl === "http://localhost:8000") merged.apiBaseUrl = "";
    // One-time: the old default was "demo" (fake data). Browsers that saved it must move to live.
    if (!localStorage.getItem(LIVE_DEFAULT_FLAG)) {
      merged.extractionMode = "live";
      localStorage.setItem(LIVE_DEFAULT_FLAG, "1");
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function krollSqlPreviewSvg(input: ManualScriptInput): string {
  const esc = (s: string) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const lines: Array<[string, string]> = [
    ["SOURCE", "Kroll PendingNewRx (SQL agent)"],
    ["PENDING RX", input.pending_rx_id != null ? String(input.pending_rx_id) : "—"],
    ["PATIENT", input.full_name || "—"],
    ["DOB", input.dob || "—"],
    ["PRESCRIBER", input.prescriber_name || "—"],
    ["LICENCE", input.license_number || "—"],
    ["DRUG ID", input.drug_id || input.drug_name || "—"],
    ["DIN", input.din || "(fill from OCR/fax)"],
    ["STRENGTH", input.strength || "—"],
    ["QTY", String(input.quantity || "—")],
    ["REFILLS", String(input.refills ?? "—")],
    ["SIG", input.sig || "—"],
  ];
  const rows = lines
    .map(
      ([k, v], i) =>
        `<text x="36" y="${110 + i * 36}" font-family="monospace" font-size="13" fill="#94a3b8">${esc(k)}</text>` +
        `<text x="200" y="${110 + i * 36}" font-family="system-ui" font-size="15" fill="#f8fafc">${esc(v).slice(0, 48)}</text>`,
    )
    .join("");
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="560" viewBox="0 0 700 560">` +
    `<rect width="700" height="560" fill="#0f172a"/>` +
    `<rect x="20" y="20" width="660" height="520" rx="12" fill="#1e293b" stroke="#334155"/>` +
    `<text x="36" y="56" font-family="system-ui" font-size="18" font-weight="700" fill="#22d3ee">KROLL SQL SNAPSHOT</text>` +
    `<text x="36" y="80" font-family="system-ui" font-size="12" fill="#64748b">SQL + OCR merge when ScriptImage is present</text>` +
    rows +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = React.useState<ProcessedDocument[]>([]);
  const [scripts, setScripts] = React.useState<Script[]>([]);
  const [settings, setSettings] = React.useState<Settings>(loadSettings);
  const [pipeline, setPipeline] = React.useState<PipelineState>({ active: false, stage: "", progress: 0 });
  const [helperStatus, setHelperStatus] = React.useState<HelperStatus>("checking");
  const [helperInfo, setHelperInfo] = React.useState<HelperInfo>({});
  const [activity, setActivity] = React.useState<ActivityEntry[]>([
    { id: "boot", at: new Date().toISOString(), text: "Queue empty — upload a fax or wait for the Kroll agent", tone: "info" },
  ]);

  const helperRef = React.useRef<LocalHelperClient>();
  if (!helperRef.current) helperRef.current = new LocalHelperClient();
  const settingsRef = React.useRef(settings);
  settingsRef.current = settings;
  const scriptsRef = React.useRef(scripts);
  scriptsRef.current = scripts;
  const sampleCursor = React.useRef(0);

  React.useEffect(() => {
    const client = helperRef.current!;
    const unsubscribe = client.subscribe(setHelperStatus);
    let cancelled = false;
    const probe = async () => {
      const info = await client.check(settings.helperUrl);
      if (!cancelled) setHelperInfo(info);
    };
    probe();
    const timer = window.setInterval(probe, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [settings.helperUrl]);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", settings.theme === "dark");
    root.style.colorScheme = settings.theme;
  }, [settings.theme]);

  React.useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  React.useEffect(() => {
    if (!settings.apiToken) return;
    void refreshLearnedMappings(settings, "default");
  }, [settings.apiToken, settings.apiBaseUrl]);

  const logActivity = React.useCallback((text: string, tone: ActivityEntry["tone"] = "info") => {
    setActivity((prev) => [{ id: uid("act"), at: new Date().toISOString(), text, tone }, ...prev].slice(0, 40));
  }, []);

  const updateSettings = React.useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const ingestFiles = React.useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setPipeline({ active: true, stage: "Reading documents", progress: 8 });
      const created: ProcessedDocument[] = [];
      for (const file of files) {
        if (file.size === 0) {
          toast.error(`${file.name} is empty (0 bytes). Re-download or re-scan it and upload again.`, { duration: Infinity });
          logActivity(`Skipped ${file.name}: file is empty`, "warn");
          continue;
        }
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        if (isPdf) {
          const buffer = await file.arrayBuffer();
          const pageCount = await countPdfPages(buffer);
          created.push({
            id: uid("doc"),
            name: file.name,
            kind: "pdf",
            sizeBytes: file.size,
            pageCount,
            addedAt: new Date().toISOString(),
            pdfData: buffer,
            pages: Array.from({ length: pageCount }, (_, index) => ({
              pageNumber: index + 1,
              is_cover_page: pageCount > 1 && index === 0,
              is_prescription: !(pageCount > 1 && index === 0),
            })),
          });
        } else if (isTiffFile(file)) {
          try {
            const urls = await tiffToPageUrls(file);
            created.push({
              id: uid("doc"),
              name: file.name,
              kind: "image",
              sizeBytes: file.size,
              pageCount: urls.length,
              addedAt: new Date().toISOString(),
              pages: urls.map((imageUrl, index) => ({
                pageNumber: index + 1,
                is_cover_page: urls.length > 1 && index === 0,
                is_prescription: !(urls.length > 1 && index === 0),
                imageUrl,
              })),
            });
          } catch (error) {
            toast.error(`Could not read ${file.name}: ${(error as Error).message}`, { duration: Infinity });
          }
        } else {
          created.push({
            id: uid("doc"),
            name: file.name,
            kind: "image",
            sizeBytes: file.size,
            pageCount: 1,
            addedAt: new Date().toISOString(),
            pages: [{ pageNumber: 1, is_cover_page: false, is_prescription: true, imageUrl: URL.createObjectURL(file) }],
          });
        }
      }
      setDocuments((prev) => [...created, ...prev]);
      setPipeline({ active: true, stage: "Vision AI extraction", progress: 54 });
      const collected: Script[] = [];
      let failures = 0;
      for (const document of created) {
        const outcome = await requestExtraction(document, settingsRef.current, (done, total) =>
          setPipeline({
            active: true,
            stage: `Vision AI extraction: page ${done} of ${total} (${document.name})`,
            progress: Math.round(54 + (done / Math.max(total, 1)) * 40),
          }),
        );
        collected.push(...outcome.scripts);
        if (outcome.warning) toast.warning(outcome.warning, { duration: 10000 });
        if (outcome.error) {
          failures += 1;
          logActivity(`Scan failed for ${document.name}: ${outcome.error}`, "warn");
          toast.error(`Could not scan ${document.name}: ${outcome.error}`, { duration: Infinity });
        }
      }
      setScripts((prev) => [...collected, ...prev]);
      setPipeline({ active: false, stage: "", progress: 0 });
      if (collected.length) {
        logActivity(`Extracted ${collected.length} prescription(s)`, "ok");
        toast.success(`${collected.length} prescription(s) ready for verification`);
      } else if (!failures) {
        toast.warning("No prescriptions were found in the upload");
      }
    },
    [logActivity],
  );

  const loadSampleFax = React.useCallback(() => {
    const built = createSampleDocument(sampleCursor.current);
    sampleCursor.current += 1;
    setDocuments((prev) => [built.document, ...prev]);
    setScripts((prev) => [...built.scripts, ...prev]);
    logActivity(`Loaded sample fax ${built.document.name}`, "warn");
  }, [logActivity]);

  const updateScript = React.useCallback((scriptId: string, patch: Partial<Script>) => {
    setScripts((prev) => prev.map((s) => (s.id === scriptId ? { ...s, ...patch } : s)));
  }, []);

  const updatePatient = React.useCallback((scriptId: string, patch: Partial<Patient>) => {
    setScripts((prev) =>
      prev.map((s) => (s.id === scriptId ? { ...s, patient: { ...s.patient, ...patch } } : s)),
    );
  }, []);

  const updatePrescriber = React.useCallback((scriptId: string, patch: Partial<Prescriber>) => {
    setScripts((prev) =>
      prev.map((s) => (s.id === scriptId ? { ...s, prescriber: { ...s.prescriber, ...patch } } : s)),
    );
  }, []);

  const updateMedication = React.useCallback((scriptId: string, medId: string, patch: Partial<Medication>) => {
    setScripts((prev) =>
      prev.map((script) => {
        if (script.id !== scriptId) return script;
        const medications = script.medications.map((med) => {
          if (med.id !== medId) return med;
          let merged = { ...med, ...patch };
          if (patch.din !== undefined || patch.is_compound !== undefined) merged = enrichMedicationFromDin(merged);
          return merged;
        });
        return {
          ...script,
          medications,
          dinVerifiedCount: medications.filter((m) => m.din_status === "verified").length,
        };
      }),
    );
  }, []);

  const addMedication = React.useCallback((scriptId: string) => {
    setScripts((prev) =>
      prev.map((script) => {
        if (script.id !== scriptId) return script;
        const blank: Medication = {
          id: uid("med"),
          drug_name: "",
          din: "",
          strength: "",
          quantity: 0,
          refills: 0,
          sig: "",
          is_compound: false,
          confidence: 1,
          din_status: "unverified",
          field_scores: { drug_name: 1, din: 1, strength: 1, quantity: 1, refills: 1, sig: 1 },
        };
        return { ...script, medications: [...script.medications, blank] };
      }),
    );
  }, []);

  const removeMedication = React.useCallback((scriptId: string, medId: string) => {
    setScripts((prev) =>
      prev.map((script) => {
        if (script.id !== scriptId) return script;
        const medications = script.medications.filter((m) => m.id !== medId);
        return {
          ...script,
          medications,
          dinVerifiedCount: medications.filter((m) => m.din_status === "verified").length,
        };
      }),
    );
  }, []);

  const reverifyDin = React.useCallback((scriptId: string, medId: string) => {
    setScripts((prev) =>
      prev.map((script) => {
        if (script.id !== scriptId) return script;
        const medications = script.medications.map((med) =>
          med.id === medId ? enrichMedicationFromDin(med) : med,
        );
        return {
          ...script,
          medications,
          dinVerifiedCount: medications.filter((m) => m.din_status === "verified").length,
        };
      }),
    );
    toast.success("DIN re-checked against Health Canada DPD");
  }, []);

  const verifyScript = React.useCallback(
    (scriptId: string) => {
      const target = scriptsRef.current.find((s) => s.id === scriptId);
      if (target) {
        const corrections = diffScriptAgainstSnapshot(target, target.extractionSnapshot);
        if (corrections.length) {
          void submitCorrections(settingsRef.current, {
            store_id: "default",
            script_id: target.id,
            document_name: target.documentName,
            corrections,
          });
        }
      }
      setScripts((prev) =>
        prev.map((s) =>
          s.id === scriptId ? { ...s, status: "verified", verifiedAt: new Date().toISOString() } : s,
        ),
      );
      toast.success("Prescription verified — ready to push");
    },
    [],
  );

  const pushScript = React.useCallback(
    async (
      scriptId: string,
      onStep: (step: KeystrokeStep, index: number, total: number) => void,
    ): Promise<PushOutcome> => {
      const script = scriptsRef.current.find((c) => c.id === scriptId);
      if (!script) {
        return { ok: false, mode: "simulated", message: "Not found", steps: [], requests: [] };
      }
      const client = helperRef.current!;
      const result = await client.pushScript(
        script,
        settingsRef.current.pms,
        settingsRef.current.helperUrl,
        onStep,
        settingsRef.current.helperToken,
      );
      if (result.ok && result.mode === "helper" && script.faxMailId) {
        // Really typed into Kroll (not simulated): tell the cloud, so the fax leaves the to-do list and the agent can
        // later compare what was pushed with what Kroll finally holds, and learn from staff changes to the sig.
        const med = script.medications[0];
        const base = settingsRef.current.apiBaseUrl.replace(/\/$/, "");
        void fetch(`${base}/api/queue`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-access-token": settingsRef.current.apiToken },
          body: JSON.stringify({
            kind: "fax",
            action: "pushed",
            store_id: script.faxStoreId || "default",
            mail_id: script.faxMailId,
            pushed: {
              patient: script.patient.full_name,
              dob: script.patient.dob,
              prescriber: script.prescriber.name,
              license: script.prescriber.license_number,
              drug: med?.drug_name,
              din: med?.din,
              qty: med?.quantity,
              refills: med?.refills,
              sig: med?.sig,
            },
          }),
        }).catch(() => undefined);
      }
      if (result.ok) {
        setScripts((prev) =>
          prev.map((c) =>
            c.id === scriptId
              ? { ...c, status: "pushed", pushedAt: new Date().toISOString(), pushedTo: settingsRef.current.pms }
              : c,
          ),
        );
      }
      if (!result.ok) toast.error(result.message);
      return result;
    },
    [],
  );

  const createManualScript = React.useCallback(
    (input: ManualScriptInput): string => {
      const documentId = uid("doc");
      const scriptId = uid("rx");
      const source = input.source ?? "manual";
      const enriched = enrichMedicationFromDin({
        din: input.din,
        drug_name: input.drug_name,
        strength: input.strength,
        is_compound: input.is_compound,
      });
      const now = new Date().toISOString();
      const preview =
        input.page_image_url || (source === "kroll_sql" ? krollSqlPreviewSvg(input) : undefined);
      const label =
        source === "kroll_sql"
          ? `Kroll SQL · Rx #${input.pending_rx_id ?? "?"} · ${input.full_name}`
          : source === "fax"
            ? `Inbound fax · ${input.full_name}`
            : `Manual entry - ${input.full_name}`;
      const document: ProcessedDocument = {
        id: documentId,
        name: label,
        kind: "image",
        sizeBytes: 0,
        pageCount: 1,
        addedAt: now,
        pages: [{ pageNumber: 1, is_cover_page: false, is_prescription: true, imageUrl: preview }],
      };
      const script: Script = {
        id: scriptId,
        documentId,
        documentName: document.name,
        pageNumber: 1,
        indexOnPage: 0,
        totalOnPage: 1,
        patient: {
          full_name: input.full_name,
          dob: input.dob,
          health_card_num: input.health_card_num,
          confidence: 0.95,
          field_scores: { full_name: 0.95, dob: 0.95, health_card_num: input.health_card_num ? 0.9 : 0.2 },
        },
        prescriber: {
          name: input.prescriber_name,
          license_number: input.license_number,
          confidence: 0.95,
          field_scores: { name: 0.95, license_number: input.license_number ? 0.95 : 0.3 },
        },
        medications: [
          {
            id: uid("med"),
            drug_name: enriched.drug_name || (input.drug_id ? `Kroll drug ${input.drug_id}` : ""),
            din: enriched.din,
            strength: enriched.strength,
            quantity: input.quantity,
            refills: input.refills,
            sig: input.sig,
            is_compound: input.is_compound,
            confidence: 0.9,
            din_status: enriched.din_status,
            din_product: enriched.din_product,
            din_candidates: input.din_candidates,
            din_source: input.din_source,
            field_scores: {
              drug_name: 0.85,
              din: enriched.din ? (input.din_source === "dpd_unique_match" ? 0.7 : 0.9) : 0.2,
              strength: enriched.strength ? 0.9 : 0.2,
              quantity: input.quantity ? 0.95 : 0.3,
              refills: 0.9,
              sig: input.sig ? 0.9 : 0.3,
            },
          },
        ],
        overallConfidence: input.confidence ?? (source === "kroll_sql" ? 0.85 : 1),
        illegible: false,
        flags:
          source === "kroll_sql"
            ? ["From Kroll SQL agent", input.page_image_url ? "ScriptImage OCR attached" : "No ScriptImage on row"]
            : source === "fax"
              ? ["Read from Kroll Inbound Docs by the agent (OCR)", "Check every field against the fax image", ...(input.extra_flags ?? [])]
              : ["Manually keyed"],
        notes: source === "kroll_sql" ? `pending_rx_id=${input.pending_rx_id ?? ""}` : "",
        status: "pending",
        dinVerifiedCount: enriched.din_status === "verified" ? 1 : 0,
        ...(input.fax_mail_id ? { faxMailId: input.fax_mail_id, faxStoreId: input.store_id } : {}),
      };
      script.extractionSnapshot = snapshotFromScript(script);
      setDocuments((prev) => [document, ...prev]);
      setScripts((prev) => [script, ...prev]);
      if (!input.quiet) toast.success(input.page_image_url ? "SQL + OCR image loaded into Verify" : "Loaded into Verify");
      return scriptId;
    },
    [],
  );

  const checkHelper = React.useCallback(async () => {
    const info = await helperRef.current!.check(settingsRef.current.helperUrl);
    setHelperInfo(info);
    if (info.error) toast.error(`Helper offline: ${settingsRef.current.helperUrl}`);
    else toast.success("Local helper connected");
  }, []);

  const resetQueue = React.useCallback(() => {
    setDocuments([]);
    setScripts([]);
    toast.success("Queue cleared");
  }, []);

  const stats = React.useMemo(() => {
    const pending = scripts.filter((s) => s.status === "pending").length;
    const pushed = scripts.filter((s) => s.status === "pushed").length;
    const verified = scripts.filter((s) => s.status === "verified").length;
    const flagged = scripts.filter(
      (s) =>
        s.illegible ||
        s.medications.some(
          (m) => m.din_status === "unverified" || m.din_status === "invalid" || m.confidence < 0.7,
        ),
    ).length;
    const averageConfidence = scripts.length
      ? scripts.reduce((sum, s) => sum + s.overallConfidence, 0) / scripts.length
      : 0;
    return { pending, verified, pushed, flagged, total: scripts.length, averageConfidence };
  }, [scripts]);

  const documentById = React.useCallback(
    (id: string) => documents.find((d) => d.id === id),
    [documents],
  );
  const scriptById = React.useCallback((id: string) => scripts.find((s) => s.id === id), [scripts]);

  const value: AppStoreValue = {
    documents,
    scripts,
    settings,
    pipeline,
    helperStatus,
    helperInfo,
    activity,
    stats,
    documentById,
    scriptById,
    updateSettings,
    ingestFiles,
    loadSampleFax,
    updatePatient,
    updatePrescriber,
    updateScript,
    updateMedication,
    addMedication,
    removeMedication,
    reverifyDin,
    verifyScript,
    pushScript,
    createManualScript,
    checkHelper,
    resetQueue,
  };

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const ctx = React.useContext(AppStoreContext);
  if (!ctx) throw new Error("useAppStore must be used within AppStoreProvider");
  return ctx;
}
