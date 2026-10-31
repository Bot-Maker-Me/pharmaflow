/**
 * Domain model for PharmFlow AI.
 *
 * The shapes below mirror the JSON contract returned by the Vision AI
 * extraction endpoint (see `src/services/vision.ts`) so that the same objects
 * can be rendered, edited, verified and pushed to the desktop helper.
 */

export type PmsId = "kroll" | "propelrx" | "winrx";

export type ScriptStatus = "pending" | "verified" | "pushed";

export type DinStatus = "verified" | "unverified" | "invalid" | "compound";

export type ConfidenceLevel = "high" | "medium" | "low";

/** Normalised (0–1) bounding box relative to a rendered document page. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Medication {
  id: string;
  drug_name: string;
  din: string;
  strength: string;
  quantity: number;
  refills: number;
  sig: string;
  is_compound: boolean;
  confidence: number;
  din_status: DinStatus;
  /** Brand / ingredient resolved from the Health Canada DPD cross-reference. */
  din_product?: string;
  bbox?: BBox;
  field_scores: Record<string, number>;
}

export interface Patient {
  full_name: string;
  dob: string;
  health_card_num: string;
  confidence: number;
  bbox?: BBox;
  field_scores: Record<string, number>;
}

export interface Prescriber {
  name: string;
  license_number: string;
  confidence: number;
  bbox?: BBox;
  field_scores: Record<string, number>;
}

export interface Script {
  id: string;
  documentId: string;
  documentName: string;
  pageNumber: number;
  /** 0-based index of the script within its page. */
  indexOnPage: number;
  totalOnPage: number;
  patient: Patient;
  prescriber: Prescriber;
  medications: Medication[];
  overallConfidence: number;
  illegible: boolean;
  flags: string[];
  notes: string;
  status: ScriptStatus;
  dinVerifiedCount: number;
  verifiedAt?: string;
  pushedAt?: string;
  pushedTo?: PmsId;
}

export interface DocumentPage {
  pageNumber: number;
  is_prescription: boolean;
  is_cover_page: boolean;
  /** Rendered page image (uploaded images and generated sample faxes). */
  imageUrl?: string;
}

export interface ProcessedDocument {
  id: string;
  name: string;
  kind: "pdf" | "image";
  sizeBytes: number;
  pageCount: number;
  addedAt: string;
  /** Raw bytes used for PDF rendering via pdf.js. */
  pdfData?: ArrayBuffer;
  pages: DocumentPage[];
}

export interface PipelineState {
  active: boolean;
  stage: string;
  progress: number;
}

export interface Settings {
  pms: PmsId;
  agentUrl: string;
  apiBaseUrl: string;
  extractionMode: "demo" | "live";
  autoAdvance: boolean;
  highThreshold: number;
  mediumThreshold: number;
}

export const DEFAULT_SETTINGS: Settings = {
  pms: "kroll",
  agentUrl: "ws://localhost:48120",
  apiBaseUrl: "http://localhost:8000",
  extractionMode: "demo",
  autoAdvance: true,
  highThreshold: 0.9,
  mediumThreshold: 0.7,
};

/** Flat, form-friendly view of a script used by the verification UI. */
export interface ExtractionPayload {
  document_metadata: {
    is_multi_page: boolean;
    page_number: number;
    is_prescription: boolean;
  };
  patient: {
    full_name: string;
    dob: string;
    health_card_num: string;
    confidence: number;
  };
  prescriber: {
    name: string;
    license_number: string;
    confidence: number;
  };
  medications: Array<{
    drug_name: string;
    din: string;
    strength: string;
    quantity: number;
    refills: number;
    sig: string;
    is_compound: boolean;
    confidence: number;
  }>;
  overall_confidence: number;
  illegible_handwriting: boolean;
}
