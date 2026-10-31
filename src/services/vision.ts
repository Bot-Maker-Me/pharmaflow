import type { ProcessedDocument, Script, Settings } from "@/lib/types";
import { resolveDinStatus } from "./dpd";
import { createSyntheticExtraction, uid } from "./mockVision";

/**
 * Vision AI extraction client.
 *
 * Contract with the backend (`POST {apiBaseUrl}/api/extract`):
 *
 *   request  { file_name, page_count, page_images: string[] }   // data URLs
 *   response { scripts: VisionScript[], model: "claude-3-5-sonnet" | "gpt-4o" }
 *
 * Demo mode short-circuits the network and uses the deterministic generator so
 * the intake/verify/push workflow is fully functional offline.
 */

export const EXTRACTION_SYSTEM_PROMPT = `You are a licensed-pharmacy intake assistant for Canadian pharmacies.
You are given a scanned faxed prescription. Extract every prescription on the page.
Rules:
- Return ONLY JSON matching the provided schema. No prose.
- Translate Latin sig abbreviations (BID, TID, QID, QHS, PRN, PO, SL, gtt) into plain English.
- Dates must be ISO 8601 (YYYY-MM-DD). Canadian health cards keep their province suffix.
- Provide a confidence score 0.0-1.0 for every field and for the whole document.
- Set is_compound = true when the product has no DIN (extemporaneous preparation).
- Set illegible_handwriting = true when any character could not be confidently read.`;

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
    const { status, product } = resolveDinStatus(med.din ?? "", isCompound);
    const confidence = med.confidence ?? 0.8;
    return {
      id: uid("med"),
      drug_name: med.drug_name,
      din: med.din ?? "",
      strength: med.strength ?? "",
      quantity: med.quantity ?? 0,
      refills: med.refills ?? 0,
      sig: med.sig ?? "",
      is_compound: isCompound,
      confidence,
      din_status: status,
      din_product: product,
      field_scores: {
        drug_name: confidence,
        din: confidence,
        strength: confidence,
        quantity: confidence,
        refills: confidence,
        sig: confidence,
      },
    };
  });

  const patientConfidence = wire.patient.confidence ?? 0.8;
  const prescriberConfidence = wire.prescriber.confidence ?? 0.8;

  return {
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
}

export async function requestExtraction(
  document: ProcessedDocument,
  settings: Settings,
): Promise<ExtractionOutcome> {
  if (settings.extractionMode !== "live") {
    return { scripts: createSyntheticExtraction(document), source: "demo" };
  }

  const pageImages = document.pages
    .map((page) => page.imageUrl)
    .filter((url): url is string => Boolean(url));

  if (!pageImages.length) {
    return {
      scripts: createSyntheticExtraction(document),
      source: "demo",
      warning: "No rendered page image available — fell back to the offline extractor.",
    };
  }

  try {
    const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, "")}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_name: document.name,
        page_count: document.pageCount,
        system_prompt: EXTRACTION_SYSTEM_PROMPT,
        page_images: pageImages,
      }),
    });

    if (!response.ok) throw new Error(`Extraction endpoint returned ${response.status}`);

    const data = (await response.json()) as { scripts?: VisionScript[] };
    const wireScripts = data.scripts ?? [];
    if (!wireScripts.length) throw new Error("Extraction endpoint returned no scripts");

    const scripts: Script[] = [];
    wireScripts.forEach((wire, index) => {
      const pageNumber = wire.document_metadata?.page_number ?? index + 1;
      const totalOnPage = wireScripts.filter(
        (candidate) => (candidate.document_metadata?.page_number ?? index + 1) === pageNumber,
      ).length;
      scripts.push(mapWireScript(wire, document, pageNumber, index, totalOnPage));
    });

    return { scripts, source: "live" };
  } catch (error) {
    return {
      scripts: createSyntheticExtraction(document),
      source: "demo",
      warning: `Live extraction unavailable (${(error as Error).message}). Showing demo data.`,
    };
  }
}
