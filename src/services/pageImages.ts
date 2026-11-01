import type { ProcessedDocument } from "@/lib/types";
import { loadPdfDocument } from "./pdf";

/**
 * Turns an intake document into JPEG data URLs suitable for the vision API.
 *
 * Uploaded images only have a `blob:` URL and PDFs have no image at all (they
 * are drawn on a canvas by pdf.js), so neither can be sent to the server as-is.
 * Pages are downscaled (long edge <= MAX_EDGE) and JPEG-compressed so a few
 * pages fit inside Vercel's 4.5 MB request limit.
 */

const MAX_EDGE = 1568;
const MAX_PAGE_CHARS = 1_100_000; // ~800 KB of JPEG per page

function canvasToJpeg(canvas: HTMLCanvasElement): string {
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_PAGE_CHARS) return url;
  }
  return canvas.toDataURL("image/jpeg", 0.3);
}

function whiteCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

async function imageUrlToJpeg(url: string): Promise<string> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not decode the uploaded image"));
    image.src = url;
  });
  const ratio = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = whiteCanvas(
    Math.max(1, Math.round(image.naturalWidth * ratio)),
    Math.max(1, Math.round(image.naturalHeight * ratio)),
  );
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasToJpeg(canvas);
}

async function pdfPageToJpeg(doc: ProcessedDocument, pageNumber: number): Promise<string> {
  const pdf = await loadPdfDocument(doc.id, doc.pdfData as ArrayBuffer);
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = MAX_EDGE / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });
  const canvas = whiteCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
  return canvasToJpeg(canvas);
}

/** One JPEG data URL per page, in page order. Throws if a page cannot be rendered. */
export async function renderDocumentPages(doc: ProcessedDocument): Promise<string[]> {
  if (doc.kind === "pdf") {
    if (!doc.pdfData) throw new Error("PDF data is missing");
    const out: string[] = [];
    for (let n = 1; n <= doc.pageCount; n += 1) out.push(await pdfPageToJpeg(doc, n));
    return out;
  }
  const out: string[] = [];
  for (const page of doc.pages) {
    if (!page.imageUrl) throw new Error("Uploaded image is missing");
    out.push(await imageUrlToJpeg(page.imageUrl));
  }
  return out;
}
