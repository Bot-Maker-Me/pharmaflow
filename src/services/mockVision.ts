import type {
  BBox,
  DocumentPage,
  ExtractionPayload,
  Medication,
  ProcessedDocument,
  Script,
} from "@/lib/types";
import { dinFromBase, resolveDinStatus } from "./dpd";

/**
 * Vision AI extraction pipeline.
 *
 * In `live` mode `src/services/vision.ts` POSTs rendered page images to the
 * extraction endpoint and validates the JSON against these shapes. In `demo`
 * mode this module synthesises a realistic extraction so the whole
 * intake -> verify -> push workflow can be exercised without API credentials:
 * it renders a fax-looking page as an SVG and derives the bounding boxes and
 * field confidences from that very same layout description.
 */

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const PAGE_W = 820;
const PAGE_H = 1280;
const ROW_H = 50;
const COL_X = [52, 430];
const COL_W = [348, 330];

interface TextOpts {
  size?: number;
  weight?: number | string;
  fill?: string;
  family?: string;
  ls?: number;
  anchor?: "start" | "end" | "middle";
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function svgText(x: number, y: number, content: string, opts: TextOpts = {}): string {
  const {
    size = 14,
    weight = 400,
    fill = "#0f172a",
    family = "'Courier New',monospace",
    ls = 0,
    anchor = "start",
  } = opts;
  const letterSpacing = ls ? ` letter-spacing="${ls}"` : "";
  const textAnchor = anchor !== "start" ? ` text-anchor="${anchor}"` : "";
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="${family}"${letterSpacing}${textAnchor}>${esc(content)}</text>`;
}

interface Cell {
  path: string;
  label: string;
  value: string;
  hand?: boolean;
  span?: 1 | 2;
}

function drawCell(
  cell: Cell,
  col: number,
  width: number,
  y: number,
  boxes: Record<string, BBox>,
  out: string[],
) {
  const x = COL_X[col];
  out.push(
    svgText(x, y, cell.label.toUpperCase(), {
      size: 10.5,
      weight: 700,
      fill: "#64748b",
      ls: 1.1,
      family: "'Helvetica Neue',Arial,sans-serif",
    }),
  );
  const family = cell.hand
    ? "'Segoe Script','Bradley Hand','Comic Sans MS',cursive"
    : "'Courier New',monospace";
  out.push(svgText(x, y + 25, cell.value, { size: cell.hand ? 22 : 19, family }));
  out.push(
    `<line x1="${x}" y1="${y + 33}" x2="${x + width}" y2="${y + 33}" stroke="#e2e8f0" stroke-width="1" />`,
  );
  const estimated = Math.min(
    width - 10,
    Math.max(64, cell.value.length * (cell.hand ? 12.6 : 10.6)),
  );
  boxes[cell.path] = { x: x / PAGE_W, y: (y + 1) / PAGE_H, w: estimated / PAGE_W, h: 32 / PAGE_H };
}

function drawCells(cells: Cell[], startY: number, boxes: Record<string, BBox>, out: string[]): number {
  let y = startY;
  let index = 0;
  while (index < cells.length) {
    const cell = cells[index];
    const next = cells[index + 1];
    if (cell.span === 2 || !next || next.span === 2) {
      drawCell(cell, 0, COL_X[1] + COL_W[1] - COL_X[0], y, boxes, out);
      index += 1;
    } else {
      drawCell(cell, 0, COL_W[0], y, boxes, out);
      drawCell(next, 1, COL_W[1], y, boxes, out);
      index += 2;
    }
    y += ROW_H;
  }
  return y;
}

interface DraftMedication {
  drug_name: string;
  din: string;
  strength: string;
  quantity: number;
  refills: number;
  sig: string;
  is_compound?: boolean;
  confidence: number;
  hand?: boolean;
}

interface DraftScript {
  patient: { full_name: string; dob: string; health_card_num: string };
  prescriber: { name: string; license_number: string };
  medications: DraftMedication[];
  patientConfidence: number;
  prescriberConfidence: number;
  illegible?: boolean;
  flags?: string[];
}

interface DraftPage {
  header: string;
  isCover?: boolean;
  scripts: DraftScript[];
}

interface DraftDocument {
  name: string;
  faxNumber: string;
  receivedAt: string;
  pages: DraftPage[];
}

function cellsForScript(draft: DraftScript, prefix: string): Cell[] {
  const cells: Cell[] = [
    { path: `${prefix}.patient.full_name`, label: "Patient name", value: draft.patient.full_name, span: 2 },
    { path: `${prefix}.patient.dob`, label: "Date of birth", value: draft.patient.dob },
    {
      path: `${prefix}.patient.health_card_num`,
      label: "Health card / provincial ID",
      value: draft.patient.health_card_num,
    },
    { path: `${prefix}.prescriber.name`, label: "Prescriber", value: draft.prescriber.name },
    {
      path: `${prefix}.prescriber.license_number`,
      label: "Licence no. (CPSO / provincial)",
      value: draft.prescriber.license_number,
    },
  ];

  draft.medications.forEach((med, index) => {
    const base = `${prefix}.medications.${index}`;
    cells.push({ path: `${base}.drug_name`, label: "Drug", value: med.drug_name, span: 2 });
    cells.push({ path: `${base}.din`, label: "DIN", value: med.is_compound ? "N/A - compound" : med.din });
    cells.push({ path: `${base}.strength`, label: "Strength", value: med.strength });
    cells.push({ path: `${base}.quantity`, label: "Quantity", value: String(med.quantity) });
    cells.push({ path: `${base}.refills`, label: "Refills", value: String(med.refills) });
    cells.push({ path: `${base}.sig`, label: "Sig / directions", value: med.sig, hand: med.hand, span: 2 });
  });

  return cells;
}

function buildPageSvg(
  mode: "single" | "multi",
  header: string,
  scripts: DraftScript[],
  meta: { faxNumber: string; receivedAt: string; pageLabel: string },
  isCover: boolean,
): { svg: string; boxes: Record<string, BBox> } {
  const boxes: Record<string, BBox> = {};
  const out: string[] = [];

  out.push(`<rect width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff" />`);
  out.push(`<rect width="${PAGE_W}" height="86" fill="#f8fafc" />`);
  out.push(`<line x1="0" y1="86" x2="${PAGE_W}" y2="86" stroke="#cbd5e1" stroke-width="2" />`);
  out.push(
    svgText(40, 34, "INBOUND FAX - PHARMACY", {
      size: 14,
      weight: 700,
      ls: 1.6,
      family: "'Helvetica Neue',Arial,sans-serif",
    }),
  );
  out.push(
    svgText(40, 62, header, { size: 12, fill: "#64748b", family: "'Helvetica Neue',Arial,sans-serif" }),
  );
  out.push(
    svgText(PAGE_W - 40, 34, meta.faxNumber, {
      size: 13,
      fill: "#334155",
      family: "'Courier New',monospace",
      anchor: "end",
    }),
  );
  out.push(
    svgText(PAGE_W - 40, 60, `${meta.receivedAt} | ${meta.pageLabel}`, {
      size: 11.5,
      fill: "#94a3b8",
      family: "'Helvetica Neue',Arial,sans-serif",
      anchor: "end",
    }),
  );

  let cursor = 130;

  if (isCover) {
    out.push(
      svgText(52, cursor, "FAX COVER SHEET", {
        size: 30,
        weight: 700,
        ls: 2,
        family: "'Helvetica Neue',Arial,sans-serif",
      }),
    );
    cursor += 40;
    out.push(`<rect x="52" y="${cursor - 4}" width="716" height="34" rx="4" fill="#fef3c7" />`);
    out.push(
      svgText(66, cursor + 20, "NOT A PRESCRIPTION - ROUTE TO INTAKE QUEUE", {
        size: 13,
        weight: 700,
        fill: "#92400e",
        family: "'Helvetica Neue',Arial,sans-serif",
      }),
    );
    cursor += 70;
    const coverLines: Array<[string, string]> = [
      ["TO", "Sunrise Community Pharmacy, 118 King St W, Hamilton ON"],
      ["FROM", "Hamilton Family Health Team - Dr. Sarah Jenkins"],
      ["PAGES", "3 (including this cover sheet)"],
      ["SUBJECT", "Signed prescriptions for the following patients"],
      ["NOTE", "Please process for delivery after 4pm."],
    ];
    coverLines.forEach(([label, value]) => {
      out.push(
        svgText(52, cursor, label, {
          size: 10.5,
          weight: 700,
          fill: "#64748b",
          ls: 1.1,
          family: "'Helvetica Neue',Arial,sans-serif",
        }),
      );
      out.push(svgText(150, cursor, value, { size: 16, family: "'Courier New',monospace" }));
      cursor += 42;
    });
    out.push(
      svgText(52, cursor + 30, "Confidentiality notice: intended only for the addressee.", {
        size: 11,
        fill: "#94a3b8",
        family: "'Helvetica Neue',Arial,sans-serif",
      }),
    );
  } else {
    scripts.forEach((draft, index) => {
      const prefix = `s${index}`;
      if (mode === "multi") {
        out.push(`<rect x="52" y="${cursor - 22}" width="716" height="28" rx="4" fill="#eff6ff" />`);
        out.push(
          svgText(64, cursor - 2, `PRESCRIPTION ${index + 1} OF ${scripts.length}`, {
            size: 11.5,
            weight: 700,
            ls: 1.3,
            fill: "#1d4ed8",
            family: "'Helvetica Neue',Arial,sans-serif",
          }),
        );
        cursor += 26;
      }
      cursor = drawCells(cellsForScript(draft, prefix), cursor + 18, boxes, out);
      if (index < scripts.length - 1) {
        out.push(
          `<line x1="52" y1="${cursor - 8}" x2="768" y2="${cursor - 8}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="6 5" />`,
        );
        cursor += 24;
      }
    });
    out.push(
      `<path d="M${COL_X[1]} ${cursor + 10} q 26 -18 52 0 q 26 18 52 0 q 26 -18 52 0" fill="none" stroke="#cbd5e1" stroke-width="2" />`,
    );
    out.push(
      svgText(52, cursor + 26, "Prescriber signature", {
        size: 10.5,
        fill: "#94a3b8",
        family: "'Helvetica Neue',Arial,sans-serif",
      }),
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" width="${PAGE_W}" height="${PAGE_H}" role="img" aria-label="Scanned prescription fax">${out.join("")}</svg>`;
  return { svg, boxes };
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface BuildScriptArgs {
  documentId: string;
  documentName: string;
  pageNumber: number;
  indexOnPage: number;
  totalOnPage: number;
  draft: DraftScript;
  boxes: Record<string, BBox>;
  prefix: string;
}

function buildScript(args: BuildScriptArgs): Script {
  const { draft, boxes, prefix } = args;

  const medications: Medication[] = draft.medications.map((med, index) => {
    const base = `${prefix}.medications.${index}`;
    const { status, product } = resolveDinStatus(med.din, Boolean(med.is_compound));
    return {
      id: uid("med"),
      drug_name: med.drug_name,
      din: med.din,
      strength: med.strength,
      quantity: med.quantity,
      refills: med.refills,
      sig: med.sig,
      is_compound: Boolean(med.is_compound),
      confidence: med.confidence,
      din_status: status,
      din_product: product,
      bbox: boxes[`${base}.din`],
      field_scores: {
        drug_name: round2(Math.min(1, med.confidence + 0.02)),
        din: med.is_compound ? 0.9 : round2(med.confidence),
        strength: round2(med.confidence),
        quantity: round2(Math.max(0.4, med.confidence - 0.03)),
        refills: round2(Math.max(0.4, med.confidence - 0.05)),
        sig: med.hand ? round2(Math.max(0.35, med.confidence - 0.2)) : round2(med.confidence),
      },
    };
  });

  const overallConfidence = round2(
    draft.patientConfidence * 0.3 +
      draft.prescriberConfidence * 0.25 +
      average(medications.map((med) => med.confidence)) * 0.45,
  );

  return {
    id: uid("rx"),
    documentId: args.documentId,
    documentName: args.documentName,
    pageNumber: args.pageNumber,
    indexOnPage: args.indexOnPage,
    totalOnPage: args.totalOnPage,
    patient: {
      full_name: draft.patient.full_name,
      dob: draft.patient.dob,
      health_card_num: draft.patient.health_card_num,
      confidence: draft.patientConfidence,
      bbox: boxes[`${prefix}.patient.full_name`],
      field_scores: {
        full_name: draft.patientConfidence,
        dob: round2(Math.max(0.4, draft.patientConfidence - 0.04)),
        health_card_num: round2(Math.max(0.4, draft.patientConfidence - 0.06)),
      },
    },
    prescriber: {
      name: draft.prescriber.name,
      license_number: draft.prescriber.license_number,
      confidence: draft.prescriberConfidence,
      bbox: boxes[`${prefix}.prescriber.name`],
      field_scores: {
        name: draft.prescriberConfidence,
        license_number: round2(Math.max(0.35, draft.prescriberConfidence - 0.08)),
      },
    },
    medications,
    overallConfidence,
    illegible: Boolean(draft.illegible),
    flags: draft.flags ?? [],
    notes: "",
    status: "pending",
    dinVerifiedCount: medications.filter((med) => med.din_status === "verified").length,
  };
}

function buildDocument(draft: DraftDocument): { document: ProcessedDocument; scripts: Script[] } {
  const documentId = uid("doc");
  const pages: DocumentPage[] = [];
  const scripts: Script[] = [];

  draft.pages.forEach((page, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const isCover = Boolean(page.isCover);
    const mode = page.scripts.length > 1 ? "multi" : "single";
    const { svg, boxes } = buildPageSvg(
      mode,
      page.header,
      page.scripts,
      {
        faxNumber: draft.faxNumber,
        receivedAt: draft.receivedAt,
        pageLabel: `Page ${pageNumber} of ${draft.pages.length}`,
      },
      isCover,
    );

    pages.push({
      pageNumber,
      is_prescription: !isCover,
      is_cover_page: isCover,
      imageUrl: svgToDataUrl(svg),
    });

    page.scripts.forEach((script, scriptIndex) => {
      scripts.push(
        buildScript({
          documentId,
          documentName: draft.name,
          pageNumber,
          indexOnPage: scriptIndex,
          totalOnPage: page.scripts.length,
          draft: script,
          boxes,
          prefix: `s${scriptIndex}`,
        }),
      );
    });
  });

  const document: ProcessedDocument = {
    id: documentId,
    name: draft.name,
    kind: "pdf",
    sizeBytes: 184320 + draft.pages.length * 24576,
    pageCount: draft.pages.length,
    addedAt: new Date().toISOString(),
    pages,
  };

  return { document, scripts };
}

const JENKINS = { name: "Dr. Sarah Jenkins", license_number: "CPSO 78901" };
const BOATENG = { name: "Dr. Marcus Boateng", license_number: "CPSO 41288" };
const PATEL = { name: "Dr. Raj Patel", license_number: "CPSO 55310" };

const SAMPLE_DRAFTS: DraftDocument[] = [
  {
    name: "KrollFax_2026-0442.pdf",
    faxNumber: "FAX 905-555-0142",
    receivedAt: "Today, 08:14",
    pages: [
      { header: "Hamilton Family Health Team - 3 pages", isCover: true, scripts: [] },
      {
        header: "Signed prescription",
        scripts: [
          {
            patient: { full_name: "John Doe", dob: "1984-06-12", health_card_num: "1234-567-890-ON" },
            prescriber: JENKINS,
            patientConfidence: 0.95,
            prescriberConfidence: 0.94,
            medications: [
              {
                drug_name: "Amoxicillin 500 mg Capsules",
                din: dinFromBase("0062811"),
                strength: "500 mg",
                quantity: 30,
                refills: 2,
                sig: "Take 1 capsule by mouth three times daily for 10 days",
                confidence: 0.98,
              },
            ],
          },
        ],
      },
      {
        header: "Continued - multiple prescriptions",
        scripts: [
          {
            patient: {
              full_name: "Eleanor Whitfield",
              dob: "1957-02-03",
              health_card_num: "9876-543-210-ON",
            },
            prescriber: BOATENG,
            patientConfidence: 0.93,
            prescriberConfidence: 0.91,
            medications: [
              {
                drug_name: "Apo-Metformin 500 mg Tablets",
                din: dinFromBase("0022651"),
                strength: "500 mg",
                quantity: 60,
                refills: 3,
                sig: "Take 1 tablet by mouth twice daily with meals",
                confidence: 0.96,
              },
            ],
          },
          {
            patient: {
              full_name: "Eleanor Whitfield",
              dob: "1957-02-03",
              health_card_num: "9876-543-210-ON",
            },
            prescriber: BOATENG,
            patientConfidence: 0.93,
            prescriberConfidence: 0.91,
            medications: [
              {
                drug_name: "Norvasc (Amlodipine) 5 mg Tablets",
                din: dinFromBase("0291234"),
                strength: "5 mg",
                quantity: 90,
                refills: 3,
                sig: "Take 1 tablet by mouth once daily",
                confidence: 0.92,
              },
            ],
          },
          {
            patient: {
              full_name: "Eleanor Whitfield",
              dob: "1957-02-03",
              health_card_num: "9876-543-210-ON",
            },
            prescriber: BOATENG,
            patientConfidence: 0.93,
            prescriberConfidence: 0.91,
            medications: [
              {
                drug_name: "Triamcinolone 0.1% in GlaxoBase Cream",
                din: "",
                strength: "0.1%",
                quantity: 100,
                refills: 0,
                sig: "Apply a thin layer to the affected area twice daily",
                is_compound: true,
                confidence: 0.9,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "PropelRxFax_2026-0443.pdf",
    faxNumber: "FAX 905-555-0188",
    receivedAt: "Today, 09:41",
    pages: [
      {
        header: "Primary Care Clinic - 2 pages",
        scripts: [
          {
            patient: { full_name: "Margaret Chen", dob: "1966-11-24", health_card_num: "4521-889-013-ON" },
            prescriber: PATEL,
            patientConfidence: 0.9,
            prescriberConfidence: 0.72,
            medications: [
              {
                drug_name: "Lipitor (Atorvastatin) 20 mg Tablets",
                din: dinFromBase("0224769"),
                strength: "20 mg",
                quantity: 90,
                refills: 3,
                sig: "Take 1 tablet by mouth once daily at bedtime",
                confidence: 0.93,
              },
            ],
          },
          {
            patient: { full_name: "Margaret Chen", dob: "1966-11-24", health_card_num: "4521-889-013-ON" },
            prescriber: PATEL,
            patientConfidence: 0.9,
            prescriberConfidence: 0.72,
            medications: [
              {
                drug_name: "Pantoloc (Pantoprazole) 40 mg Tablets",
                din: dinFromBase("0251650"),
                strength: "40 mg",
                quantity: 90,
                refills: 3,
                sig: "Take 1 tablet by mouth 30 minutes before breakfast",
                confidence: 0.89,
              },
            ],
          },
        ],
      },
      {
        header: "Handwritten follow-up",
        scripts: [
          {
            patient: { full_name: "Theo Okafor", dob: "1971-08-09", health_card_num: "3320-118-902-ON" },
            prescriber: { name: "Dr. A. Nwosu", license_number: "" },
            patientConfidence: 0.61,
            prescriberConfidence: 0.52,
            illegible: true,
            flags: ["Handwritten sig - partial character recognition"],
            medications: [
              {
                drug_name: "Ventolin HFA 100 mcg Inhaler",
                din: dinFromBase("0219593"),
                strength: "100 mcg/actuation",
                quantity: 1,
                refills: 0,
                sig: "Inhale 2 puffs every 4-6 hours as needed for shortness of breath",
                confidence: 0.58,
                hand: true,
              },
            ],
          },
        ],
      },
    ],
  },
];

/** Seed data so the queue and verification workspace are populated on load. */
export function createSampleDocuments(): { documents: ProcessedDocument[]; scripts: Script[] } {
  const documents: ProcessedDocument[] = [];
  const scripts: Script[] = [];
  SAMPLE_DRAFTS.forEach((draft) => {
    const built = buildDocument(draft);
    documents.push(built.document);
    scripts.push(...built.scripts);
  });
  return { documents, scripts };
}

/** Generate a fresh single-document sample (used by the "Load sample fax" action). */
export function createSampleDocument(rotation: number): { document: ProcessedDocument; scripts: Script[] } {
  const base = SAMPLE_DRAFTS[rotation % SAMPLE_DRAFTS.length];
  const now = new Date();
  const suffix = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return buildDocument({
    ...base,
    name: base.name.replace(/\.pdf$/i, `_${suffix}.pdf`),
  });
}

let syntheticCursor = 0;

/**
 * Extraction for an uploaded file in Demo Mode: produces one script per page,
 * rotating through the sample drafts so different uploads yield different data.
 */
export function createSyntheticExtraction(document: ProcessedDocument): Script[] {
  const scripts: Script[] = [];
  const pool = [SAMPLE_DRAFTS[0].pages[1].scripts[0], ...SAMPLE_DRAFTS[1].pages[0].scripts];
  const total = Math.max(1, document.pageCount);

  for (let pageIndex = 0; pageIndex < total; pageIndex += 1) {
    const picked = pool[syntheticCursor % pool.length];
    syntheticCursor += 1;
    const built = buildScript({
      documentId: document.id,
      documentName: document.name,
      pageNumber: pageIndex + 1,
      indexOnPage: 0,
      totalOnPage: 1,
      draft: picked,
      boxes: {},
      prefix: "s0",
    });
    built.flags = ["Simulated extraction - connect the Vision AI endpoint for live parsing"];
    scripts.push(built);
  }

  return scripts;
}

/** Serialise a verified script back into the wire format pushed to the helper. */
export function toExtractionPayload(script: Script, isMultiPage: boolean): ExtractionPayload {
  return {
    document_metadata: {
      is_multi_page: isMultiPage,
      page_number: script.pageNumber,
      is_prescription: true,
    },
    patient: {
      full_name: script.patient.full_name,
      dob: script.patient.dob,
      health_card_num: script.patient.health_card_num,
      confidence: script.patient.confidence,
    },
    prescriber: {
      name: script.prescriber.name,
      license_number: script.prescriber.license_number,
      confidence: script.prescriber.confidence,
    },
    medications: script.medications.map((med) => ({
      drug_name: med.drug_name,
      din: med.din,
      strength: med.strength,
      quantity: med.quantity,
      refills: med.refills,
      sig: med.sig,
      is_compound: med.is_compound,
      confidence: med.confidence,
    })),
    overall_confidence: script.overallConfidence,
    illegible_handwriting: script.illegible,
  };
}
