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

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = React.useState<ProcessedDocument[]>([]);
  const [scripts, setScripts] = React.useState<Script[]>([]);
  const [settings, setSettings] = React.useState<Settings>(loadSettings);
  const [pipeline, setPipeline] = React.useState<PipelineState>({
    active: false,
    stage: "",
    progress: 0,
  });
  const [helperStatus, setHelperStatus] = React.useState<HelperStatus>("checking");
  const [helperInfo, setHelperInfo] = React.useState<HelperInfo>({});
  const [activity, setActivity] = React.useState<ActivityEntry[]>([
    {
      id: "boot",
      at: new Date().toISOString(),
      text: "Queue empty — upload a fax or wait for the Kroll agent",
      tone: "info",
    },
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
    setActivity((prev) =>
      [{ id: uid("act"), at: new Date().toISOString(), text, tone }, ...prev].slice(0, 40),
    );
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
        } else {
          created.push({
            id: uid("doc"),
            name: file.name,
            kind: "image",
            sizeBytes: file.size,
            pageCount: 1,
            addedAt: new Date().toISOString(),
            pages: [
              {
                pageNumber: 1,
                is_cover_page: false,
                is_prescription: true,
                imageUrl: URL.createObjectURL(file),
              },
            ],
          });
        }
      }

      setDocuments((prev) => [...created, ...prev]);
      setPipeline({ active: true, stage: "Splitting fax cover pages", progress: 26 });
      await delay(360);

      setPipeline({ active: true, stage: "Vision AI extraction", progress: 54 });
      const collected: Script[] = [];
      for (const document of created) {
        const outcome = await requestExtraction(document, settingsRef.current);
        collected.push(...outcome.scripts);
        if (outcome.warning) toast.warning(outcome.warning);
      }

      await delay(280);
      setPipeline({ active: true, stage: "Health Canada DIN cross-reference", progress: 84 });
      await delay(260);

      setScripts((prev) => [...collected, ...prev]);
      setPipeline({ active: true, stage: "Queued for verification", progress: 100 });
      logActivity(
        `Extracted ${collected.length} prescription${collected.length === 1 ? "" : "s"} from ${created.length} document${created.length === 1 ? "" : "s"}`,
        "ok",
      );
      await delay(420);
      setPipeline({ active: false, stage: "", progress: 0 });
      toast.success(`${collected.length} prescription(s) ready for verification`);
    },
    [logActivity],
  );

  const loadSampleFax = React.useCallback(() => {
    const built = createSampleDocument(sampleCursor.current);
    sampleCursor.current += 1;
    setDocuments((prev) => [built.document, ...prev]);
    setScripts((prev) => [...built.scripts, ...prev]);
    logActivity(`Loaded sample fax ${built.document.name} (demo only)`, "warn");
    toast.message("Sample fax loaded — demo data only");
  }, [logActivity]);

  const updateScript = React.useCallback((scriptId: string, patch: Partial<Script>) => {
    setScripts((prev) => prev.map((script) => (script.id === scriptId ? { ...script, ...patch } : script)));
  }, []);

  const updatePatient = React.useCallback((scriptId: string, patch: Partial<Patient>) => {
    setScripts((prev) =>
      prev.map((script) =>
        script.id === scriptId ? { ...script, patient: { ...script.patient, ...patch } } : script,
      ),
    );
  }, []);

  const updatePrescriber = React.useCallback((scriptId: string, patch: Partial<Prescriber>) => {
    setScripts((prev) =>
      prev.map((script) =>
        script.id === scriptId
          ? { ...script, prescriber: { ...script.prescriber, ...patch } }
          : script,
      ),
    );
  }, []);

  const updateMedication = React.useCallback(
    (scriptId: string, medId: string, patch: Partial<Medication>) => {
      setScripts((prev) =>
        prev.map((script) => {
          if (script.id !== scriptId) return script;
          const medications = script.medications.map((med) => {
            if (med.id !== medId) return med;
            let merged = { ...med, ...patch };
            if (patch.din !== undefined || patch.is_compound !== undefined) {
              merged = enrichMedicationFromDin(merged);
            }
            return merged;
          });
          return {
            ...script,
            medications,
            dinVerifiedCount: medications.filter((med) => med.din_status === "verified").length,
          };
        }),
      );
    },
    [],
  );

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
        const medications = script.medications.filter((med) => med.id !== medId);
        return {
          ...script,
          medications,
          dinVerifiedCount: medications.filter((med) => med.din_status === "verified").length,
        };
      }),
    );
  }, []);

  const reverifyDin = React.useCallback((scriptId: string, medId: string) => {
    setScripts((prev) =>
      prev.map((script) => {
        if (script.id !== scriptId) return script;
        const medications = script.medications.map((med) => {
          if (med.id !== medId) return med;
          return enrichMedicationFromDin(med);
        });
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
      const target = scriptsRef.current.find((script) => script.id === scriptId);
      if (target) {
        const corrections = diffScriptAgainstSnapshot(target, target.extractionSnapshot);
        if (corrections.length) {
          void submitCorrections(settingsRef.current, {
            store_id: "default",
            script_id: target.id,
            document_name: target.documentName,
            corrections,
          }).then((result) => {
            if (result.ok && (result.saved ?? 0) > 0) {
              logActivity(`Learned ${result.saved} correction(s) from ${target.patient.full_name}`, "ok");
            }
          });
        }
      }

      setScripts((prev) =>
        prev.map((script) =>
          script.id === scriptId
            ? { ...script, status: "verified", verifiedAt: new Date().toISOString() }
            : script,
        ),
      );
      logActivity(`Verified ${target ? target.patient.full_name : "prescription"}`, "ok");
      toast.success(
        target && diffScriptAgainstSnapshot(target, target.extractionSnapshot).length
          ? "Verified — corrections saved for learning"
          : "Prescription verified — ready to push",
      );
    },
    [logActivity],
  );

  const pushScript = React.useCallback(
    async (
      scriptId: string,
      onStep: (step: KeystrokeStep, index: number, total: number) => void,
    ): Promise<PushOutcome> => {
      const script = scriptsRef.current.find((candidate) => candidate.id === scriptId);
      if (!script) {
        return {
          ok: false,
          mode: "simulated",
          message: "Prescription not found in the queue.",
          steps: [],
          requests: [],
        };
      }

      const corrections = diffScriptAgainstSnapshot(script, script.extractionSnapshot);
      if (corrections.length) {
        void submitCorrections(settingsRef.current, {
          store_id: "default",
          script_id: script.id,
          document_name: script.documentName,
          corrections,
        });
      }

      const client = helperRef.current!;
      const result = await client.pushScript(
        script,
        settingsRef.current.pms,
        settingsRef.current.helperUrl,
        onStep,
        settingsRef.current.helperToken,
      );

      if (result.ok) {
        setScripts((prev) =>
          prev.map((candidate) =>
            candidate.id === scriptId
              ? {
                  ...candidate,
                  status: "pushed",
                  pushedAt: new Date().toISOString(),
                  pushedTo: settingsRef.current.pms,
                }
              : candidate,
          ),
        );
      }

      logActivity(
        result.mode === "helper"
          ? `${result.message} (${script.patient.full_name})`
          : `Simulated keystroke push for ${script.patient.full_name} — helper offline`,
        result.ok ? (result.mode === "helper" ? "ok" : "warn") : "warn",
      );

      if (!result.ok) toast.error(result.message);
      return result;
    },
    [logActivity],
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
      const preview = source === "kroll_sql" ? krollSqlPreviewSvg(input) : undefined;
      const label =
        source === "kroll_sql"
          ? `Kroll SQL · Rx #${input.pending_rx_id ?? "?"} · ${input.full_name}`
          : `Manual entry - ${input.full_name}`;
      const document: ProcessedDocument = {
        id: documentId,
        name: label,
        kind: "image",
        sizeBytes: 0,
        pageCount: 1,
        addedAt: now,
        pages: [
          {
            pageNumber: 1,
            is_cover_page: false,
            is_prescription: true,
            imageUrl: preview,
          },
        ],
      };
      const flags =
        source === "kroll_sql"
          ? [
              "From Kroll SQL agent (Pipeline A)",
              "Health card / provincial ID missing",
              input.din ? "" : "No DIN captured",
              input.strength ? "" : "Strength missing",
            ].filter(Boolean)
          : ["Manually keyed by technician"];
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
          confidence: source === "kroll_sql" ? 0.95 : 1,
          field_scores: {
            full_name: 0.95,
            dob: 0.95,
            health_card_num: input.health_card_num ? 0.9 : 0.2,
          },
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
            field_scores: {
              drug_name: 0.85,
              din: enriched.din ? 0.9 : 0.2,
              strength: enriched.strength ? 0.9 : 0.2,
              quantity: input.quantity ? 0.95 : 0.3,
              refills: 0.9,
              sig: input.sig ? 0.9 : 0.3,
            },
          },
        ],
        overallConfidence: source === "kroll_sql" ? 0.85 : 1,
        illegible: false,
        flags,
        notes:
          source === "kroll_sql"
            ? `store=${input.store_id ?? "default"}; pending_rx_id=${input.pending_rx_id ?? ""}`
            : "",
        status: "pending",
        dinVerifiedCount: enriched.din_status === "verified" ? 1 : 0,
      };
      script.extractionSnapshot = snapshotFromScript(script);
      setDocuments((prev) => [document, ...prev]);
      setScripts((prev) => [script, ...prev]);
      logActivity(
        source === "kroll_sql"
          ? `Loaded Kroll SQL Rx #${input.pending_rx_id} for ${input.full_name}`
          : `Manually keyed a prescription for ${input.full_name}`,
        "info",
      );
      toast.success(
        source === "kroll_sql"
          ? "SQL row loaded into Verify — complete DIN / health card"
          : "Prescription added to the queue",
      );
      return scriptId;
    },
    [logActivity],
  );

  const checkHelper = React.useCallback(async () => {
    const client = helperRef.current!;
    const info = await client.check(settingsRef.current.helperUrl);
    setHelperInfo(info);
    if (info.error) toast.error(`Local helper unreachable at ${settingsRef.current.helperUrl}`);
    else toast.success(`Local helper ${info.version ?? ""} connected`.trim());
  }, []);

  const resetQueue = React.useCallback(() => {
    setDocuments([]);
    setScripts([]);
    logActivity("Queue cleared", "info");
    toast.success("Queue cleared");
  }, [logActivity]);

  const stats = React.useMemo(() => {
    const pending = scripts.filter((script) => script.status === "pending").length;
    const pushed = scripts.filter((script) => script.status === "pushed").length;
    const verified = scripts.filter((script) => script.status === "verified").length;
    const flagged = scripts.filter(
      (script) =>
        script.illegible ||
        script.medications.some(
          (med) =>
            med.din_status === "unverified" ||
            med.din_status === "invalid" ||
            med.is_compound ||
            med.confidence < 0.7,
        ),
    ).length;
    const averageConfidence = scripts.length
      ? scripts.reduce((sum, script) => sum + script.overallConfidence, 0) / scripts.length
      : 0;
    return {
      pending,
      verified,
      pushed,
      flagged,
      total: scripts.length,
      averageConfidence,
    };
  }, [scripts]);

  const documentById = React.useCallback(
    (id: string) => documents.find((document) => document.id === id),
    [documents],
  );
  const scriptById = React.useCallback((id: string) => scripts.find((script) => script.id === id), [scripts]);

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
