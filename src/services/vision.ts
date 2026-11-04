import type { ProcessedDocument, Script, Settings } from "@/lib/types";
import { enrichMedicationFromDin } from "./dpd";
import {
  applyLearnedToMedication,
  applyLearnedToScript,
  fewShotHintsFromMappings,
  refreshLearnedMappings,
  snapshotFromScript,
} from "./learn";
import { createSyntheticExtraction, uid } from "./mockVision";
import { renderDocumentPages } from "./pageImages";

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
  }>;
  overall_confidence?: number;
  illegible_handwriting?: boolean;
}

export interface ExtractionOutcome {
  scripts: Script[];
  source: "live" | "demo";
  warning?: string;
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
      field_scores: {
        drug_name: confidence,
        din: confidence,
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

const PAGES_PER_REQUEST = 3;

export async function requestExtraction(
  document: ProcessedDocument,
  settings: Settings,
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
    return { scripts, source: "demo" };
  }

  try {
    const pageImages = await renderDocumentPages(document);
    const endpoint = `${settings.apiBaseUrl.replace(/\/$/, "")}/api/extract`;
    const wireScripts: VisionScript[] = [];
    const hints = fewShotHintsFromMappings(10);

    for (let offset = 0; offset < pageImages.length; offset += PAGES_PER_REQUEST) {
      const batch = pageImages.slice(offset, offset + PAGES_PER_REQUEST);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(settings.apiToken ? { "x-access-token": settings.apiToken } : {}),
        },
        body: JSON.stringify({
          file_name: document.name,
          page_count: document.pageCount,
          page_images: batch,
          store_id: storeId,
          learn_hints: hints,
        }),
      });

      if (response.status === 401) throw new Error("Wrong or missing API access token (Settings)");
      if (!response.ok) throw new Error(`Extraction endpoint returned ${response.status}`);

      const data = (await response.json()) as { scripts?: VisionScript[] };
      for (const wire of data.scripts ?? []) {
        const pageNumber = (wire.document_metadata?.page_number ?? 1) + offset;
        wireScripts.push({
          ...wire,
          document_metadata: { ...wire.document_metadata, page_number: pageNumber },
        });
      }
    }

    if (!wireScripts.length) throw new Error("No prescriptions were found in the document");

    const scripts: Script[] = wireScripts.map((wire, index) => {
      const pageNumber = wire.document_metadata?.page_number ?? 1;
      const onPage = wireScripts.filter(
        (candidate) => (candidate.document_metadata?.page_number ?? 1) === pageNumber,
      );
      return mapWireScript(wire, document, pageNumber, onPage.indexOf(wire), onPage.length || index + 1);
    });

    return { scripts, source: "live" };
  } catch (error) {
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
      warning: `Live extraction unavailable (${(error as Error).message}). Showing DEMO data — do not use it for real patients.`,
    };
  }
}
