import type { DinCandidate, ProcessedDocument, Script, Settings } from "@/lib/types";
import { enrichMedicationFromDin } from "./dpd";
import {
  applyLearnedToMedication,
  applyLearnedToScript,
  fewShotHintsFromMappings,
  refreshLearnedMappings,
  snapshotFromScript,
} from "./learn";
import { createSyntheticExtraction, uid } from "./mockVision";
import { renderDocumentPage } from "./pageImages";

/**
 * Vision AI extraction client.
 *
 * Contract with the backend (`POST {apiBaseUrl}/api/extract`):
 *
 *   request  { file_name, page_count, page_images: string[], store_id?, learn_hints? }
 *   response { scripts: VisionScript[], model, learn_applied? }
 *
 * Demo mode short-circuits the network and uses the deterministic generator so
 * the intake/verify/push workflow is fully functional offline.
 */

export const EXTRACTION_SYSTEM_PROMPT = `You are a licensed-pharmacy intake assistant for Canadian pharmacies.
You are given a scanned faxed prescription. Extract every prescription on the page.
Rules:
- Return ONLY JSON matching the provided schema. No prose.
- Always capture drug_name, strength, DIN when printed, health_card_num when printed.
- Translate Latin sig abbreviations (BID, TID, QID, QHS, PRN, PO, SL, gtt) into plain English.
- Dates must be ISO 8601 (YYYY-MM-DD). Canadian health cards keep their province suffix.
- Provide a confidence score 0.0-1.0 for every field and for the whole document.
- Set is_compound = true when the product has no DIN (extemporaneous preparation).
- Set illegible_handwriting = true when any character could not be confidently read.
- NEVER invent a DIN or health card number.`;

export interface VisionScript {
  document_metadata?: { is_multi_page?: boolean; page_number?: number; is_prescription?: boolean };
  patient: { full_name: string; dob: string; health_card_num: string; confidence?: number };
  prescriber: { name: string; license_number: string; confidence?: number };
  medications: Array<{
    drug_name: string;
    din: string;
    strength?: string;
    quantity?: number;
    refills?: number;
    sig?: string;
    is_compound?: boolean;
    confidence?: number;
    din_candidates?: DinCandidate[];
    din_source?: string;
  }>;
  overall_confidence?: number;
  illegible_handwriting?: boolean;
}

export interface ExtractionOutcome {
  scripts: Script[];
  source: "live" | "demo";
  /** Non-fatal notice (e.g. demo mode is on). */
  warning?: string;
  /** Live extraction failed. No scripts are produced: fake data is never substituted for a real fax. */
  error?: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapWireScript(
  wire: VisionScript,
  document: ProcessedDocument,
  pageNumber: number,
  indexOnPage: number,
  totalOnPage: number,
): Script {
  const medications = wire.medications.map((med) => {
    const isCompound = Boolean(med.is_compound);
    const confidence = med.confidence ?? 0.8;
    let enriched = enrichMedicationFromDin({
      drug_name: med.drug_name ?? "",
      din: med.din ?? "",
      strength: med.strength ?? "",
      is_compound: isCompound,
    });
    const base = {
      id: uid("med"),
      drug_name: enriched.drug_name,
      din: enriched.din,
      strength: enriched.strength,
      quantity: med.quantity ?? 0,
      refills: med.refills ?? 0,
      sig: med.sig ?? "",
      is_compound: isCompound,
      confidence,
      din_status: enriched.din_status,
      din_product: enriched.din_product,
      din_candidates: med.din_candidates,
      din_source: med.din_source,
      field_scores: {
        drug_name: confidence,
        din: med.din_source === "dpd_unique_match" ? Math.min(confidence, 0.7) : confidence,
        strength: confidence,
        quantity: confidence,
        refills: confidence,
        sig: confidence,
      },
    };
    return applyLearnedToMedication(base);
  });

  const patientConfidence = wire.patient.confidence ?? 0.8;
  const prescriberConfidence = wire.prescriber.confidence ?? 0.8;

  let script: Script = {
    id: uid("rx"),
    documentId: document.id,
    documentName: document.name,
    pageNumber,
    indexOnPage,
    totalOnPage,
    patient: {
      full_name: wire.patient.full_name,
      dob: wire.patient.dob,
      health_card_num: wire.patient.health_card_num,
      confidence: patientConfidence,
      field_scores: {
        full_name: patientConfidence,
        dob: patientConfidence,
        health_card_num: patientConfidence,
      },
    },
    prescriber: {
      name: wire.prescriber.name,
      license_number: wire.prescriber.license_number,
      confidence: prescriberConfidence,
      field_scores: { name: prescriberConfidence, license_number: prescriberConfidence },
    },
    medications,
    overallConfidence: round2(
      wire.overall_confidence ??
        (patientConfidence * 0.3 +
          prescriberConfidence * 0.25 +
          (medications.reduce((sum, med) => sum + med.confidence, 0) / (medications.length || 1)) * 0.45),
    ),
    illegible: Boolean(wire.illegible_handwriting),
    flags: [],
    notes: "",
    status: "pending",
    dinVerifiedCount: medications.filter((med) => med.din_status === "verified").length,
  };

  // Second pass: patient/prescriber + any remaining med text_replace rules
  script = applyLearnedToScript(script);
  script.extractionSnapshot = snapshotFromScript(script);
  return script;
}

/** One page per request keeps every request small (Vercel's 4.5 MB limit) and lets pages run in parallel. */
const PAGE_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 90_000;

/** Turn a failed /api/extract response into a message the user can act on. */
async function describeFailure(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: string };
    detail = body?.error ?? "";
  } catch {
    /* non-JSON body */
  }
  if (response.status === 401) {
    return "Wrong or missing API access token. Settings → API access token must equal EXTRACT_ACCESS_TOKEN in Vercel.";
  }
  if (response.status === 404) {
    return "The /api/extract endpoint was not found. Check Settings → API base URL (leave it blank on Vercel).";
  }
  if (response.status === 413) return detail || "The scan is too large to send. Try fewer pages.";
  return detail || `Extraction endpoint returned ${response.status}`;
}

export async function requestExtraction(
  document: ProcessedDocument,
  settings: Settings,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractionOutcome> {
  // Pull latest staff/shadow corrections so this extract benefits immediately.
  const storeId =
    (settings as { storeId?: string }).storeId ||
    (settings as { store_id?: string }).store_id ||
    "default";
  try {
    await refreshLearnedMappings(settings, storeId);
  } catch {
    /* offline / no token — local cache still applies */
  }

  if (settings.extractionMode !== "live") {
    const scripts = createSyntheticExtraction(document).map((s) => {
      const withLearn = applyLearnedToScript({
        ...s,
        medications: s.medications.map((m) => applyLearnedToMedication(m)),
      });
      return {
        ...withLearn,
        extractionSnapshot: withLearn.extractionSnapshot ?? snapshotFromScript(withLearn),
      };
    });
    return {
      scripts,
      source: "demo",
      warning: "Demo mode is ON: this is sample data, NOT read from your fax. Switch to Live in Settings.",
    };
  }

  try {
    const total = document.kind === "pdf" ? document.pageCount : document.pages.length;
    const endpoint = `${settings.apiBaseUrl.replace(/\/$/, "")}/api/extract`;
    const hints = fewShotHintsFromMappings(10);

    interface PageResult {
      pageNumber: number;
      scripts: VisionScript[];
      note?: string;
      error?: string;
      fatal?: boolean;
    }
    const results: PageResult[] = [];
    const pending = Array.from({ length: total }, (_, index) => index);
    let done = 0;

    async function scanPage(index: number): Promise<PageResult> {
      const pageNumber = index + 1;
      const image = await renderDocumentPage(document, index);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(settings.apiToken ? { "x-access-token": settings.apiToken } : {}),
            },
            body: JSON.stringify({
              file_name: document.name,
              page_count: total,
              page_images: [image],
              store_id: storeId,
              learn_hints: hints,
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        } catch {
          if (attempt === 2) return { pageNumber, scripts: [], error: "the request timed out or the network dropped" };
          await new Promise((resolve) => setTimeout(resolve, 2500));
          continue;
        }
        if (response.ok) {
          const data = (await response.json()) as { scripts?: VisionScript[]; warning?: string };
          return { pageNumber, scripts: data.scripts ?? [], note: data.warning };
        }
        const retryable = response.status === 429 || response.status === 503 || response.status === 504;
        if (retryable && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
          continue;
        }
        // Wrong token / missing endpoint will fail on every page: stop early and report it once.
        return { pageNumber, scripts: [], error: await describeFailure(response), fatal: response.status === 401 || response.status === 404 };
      }
      return { pageNumber, scripts: [], error: "unknown error" };
    }

    async function worker() {
      while (pending.length) {
        if (results.some((result) => result.fatal)) return;
        const index = pending.shift()!;
        try {
          results.push(await scanPage(index));
        } catch (error) {
          results.push({ pageNumber: index + 1, scripts: [], error: (error as Error).message });
        }
        done += 1;
        onProgress?.(done, total);
      }
    }
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, total) }, worker));
    results.sort((a, b) => a.pageNumber - b.pageNumber);

    const wireScripts: VisionScript[] = [];
    for (const result of results) {
      for (const wire of result.scripts) {
        wireScripts.push({ ...wire, document_metadata: { ...wire.document_metadata, page_number: result.pageNumber } });
      }
    }

    const failed = results.filter((result) => result.error);
    if (!wireScripts.length) {
      const reason = failed[0]?.error ?? results.find((result) => result.note)?.note;
      throw new Error(reason ?? "No prescriptions were found in the document");
    }
    const notices: string[] = [];
    if (failed.length) {
      notices.push(`Page${failed.length > 1 ? "s" : ""} ${failed.map((r) => r.pageNumber).join(", ")} could not be read (${failed[0].error}). Re-upload those pages.`);
    }
    for (const result of results) {
      if (result.note && /cut off/i.test(result.note)) notices.push(`Page ${result.pageNumber}: ${result.note}`);
    }

    const scripts: Script[] = wireScripts.map((wire, index) => {
      const pageNumber = wire.document_metadata?.page_number ?? 1;
      const onPage = wireScripts.filter(
        (candidate) => (candidate.document_metadata?.page_number ?? 1) === pageNumber,
      );
      return mapWireScript(wire, document, pageNumber, onPage.indexOf(wire), onPage.length || index + 1);
    });

    return { scripts, source: "live", ...(notices.length ? { warning: notices.join(" ") } : {}) };
  } catch (error) {
    return { scripts: [], source: "live", error: (error as Error).message };
  }
}
