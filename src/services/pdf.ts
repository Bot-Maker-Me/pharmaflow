import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const cache = new Map<string, Promise<PDFDocumentProxy>>();
const inflight = new WeakMap<HTMLCanvasElement, { cancel: () => void }>();

/** Load (and memoise) a PDF document for a given intake document id. */
export function loadPdfDocument(id: string, data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const cached = cache.get(id);
  if (cached) return cached;
  const task = pdfjs.getDocument({ data: data.slice(0) }).promise;
  cache.set(id, task);
  task.catch(() => cache.delete(id));
  return task;
}

export async function countPdfPages(data: ArrayBuffer): Promise<number> {
  try {
    const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise;
    return pdf.numPages;
  } catch {
    return 1;
  }
}

export interface RenderRequest {
  id: string;
  data: ArrayBuffer;
  pageNumber: number;
  scale: number;
  rotation: number;
  canvas: HTMLCanvasElement;
}

/**
 * Renders a single PDF page into the supplied canvas and returns the CSS pixel
 * size so bounding-box overlays can be positioned with percentages.
 */
export async function renderPdfPage(request: RenderRequest): Promise<{ width: number; height: number }> {
  const canvas = request.canvas;
  const pending = inflight.get(canvas);
  if (pending) {
    try {
      pending.cancel();
    } catch {
      /* previous render already settled */
    }
  }

  const pdf = await loadPdfDocument(request.id, request.data);
  const page = await pdf.getPage(request.pageNumber);
  const viewport = page.getViewport({ scale: request.scale, rotation: request.rotation });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const task = page.render({
    canvasContext: context,
    viewport,
    transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
  });
  inflight.set(canvas, task);

  await task.promise;
  return { width: viewport.width, height: viewport.height };
}
