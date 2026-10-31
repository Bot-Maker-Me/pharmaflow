import * as React from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, EyeOff, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LEVEL_STYLES } from "@/lib/confidence";
import { renderPdfPage } from "@/services/pdf";
import { cn } from "@/lib/utils";
import type { BBox, ConfidenceLevel, ProcessedDocument } from "@/lib/types";

export interface ViewerOverlay {
  id: string;
  box: BBox;
  level: ConfidenceLevel;
  label: string;
  active: boolean;
}

interface DocumentViewerProps {
  document: ProcessedDocument;
  pageNumber: number;
  onPageChange: (page: number) => void;
  overlays: ViewerOverlay[];
  onSelectField: (id: string) => void;
  activeFieldId?: string;
}

const BASE_IMAGE_WIDTH = 700;
const PDF_BASE_SCALE = 1.35;

export function DocumentViewer({
  document,
  pageNumber,
  onPageChange,
  overlays,
  onSelectField,
  activeFieldId,
}: DocumentViewerProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [showOverlays, setShowOverlays] = React.useState(true);
  const [pdfError, setPdfError] = React.useState<string | null>(null);
  const [rendering, setRendering] = React.useState(false);

  const page = document.pages.find((candidate) => candidate.pageNumber === pageNumber) ?? document.pages[0];
  const totalPages = document.pageCount;
  // Rendered faxes (samples and uploaded images) ship a page image; real PDFs
  // are rasterised through pdf.js instead.
  const pageImage = page?.imageUrl;
  const usesCanvas = !pageImage && Boolean(document.pdfData);

  React.useEffect(() => {
    if (!usesCanvas || !document.pdfData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    setRendering(true);
    setPdfError(null);

    renderPdfPage({
      id: document.id,
      data: document.pdfData,
      pageNumber,
      scale: PDF_BASE_SCALE * zoom,
      rotation,
      canvas,
    })
      .then(() => {
        if (!cancelled) setRendering(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        if (!/cancel/i.test(message)) setPdfError(message);
        setRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [document.id, document.pdfData, usesCanvas, pageNumber, rotation, zoom]);

  const wrapped = rotation % 360 !== 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-card px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.15).toFixed(2))))}
          aria-label="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setZoom((value) => Math.min(3, Number((value + 0.15).toFixed(2))))}
          aria-label="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setRotation((value) => (value + 90) % 360)}
          aria-label="Rotate"
        >
          <RotateCw className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showOverlays ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setShowOverlays((value) => !value)}
              aria-label="Toggle detected field highlights"
            >
              {showOverlays ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {showOverlays ? "Hide detected field boxes" : "Show detected field boxes"}
          </TooltipContent>
        </Tooltip>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pageNumber <= 1}
            onClick={() => onPageChange(pageNumber - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {pageNumber} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pageNumber >= totalPages}
            onClick={() => onPageChange(pageNumber + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin bg-grid">
        <div className="flex min-h-full items-start justify-center p-6">
          <div
            className="relative bg-white shadow-xl ring-1 ring-slate-300"
            style={{
              width: usesCanvas ? undefined : Math.round(BASE_IMAGE_WIDTH * zoom),
              transform: wrapped ? `rotate(${rotation}deg)` : undefined,
            }}
          >
            {usesCanvas ? (
              <>
                <canvas ref={canvasRef} className="block" />
                {rendering ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-xs text-muted-foreground">
                    Rendering page…
                  </div>
                ) : null}
              </>
            ) : pageImage ? (
              <img src={pageImage} alt={`${document.name} page ${pageNumber}`} className="block w-full" />
            ) : (
              <div className="flex h-[420px] w-[320px] flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                No preview available for this page.
              </div>
            )}

            {showOverlays && !pdfError
              ? overlays.map((overlay) => (
                  <button
                    key={overlay.id}
                    type="button"
                    onClick={() => onSelectField(overlay.id)}
                    title={overlay.label}
                    className={cn(
                      "absolute rounded-sm border transition-all",
                      overlay.active
                        ? "border-2 border-primary bg-primary/20 ring-2 ring-primary/40"
                        : "border border-dashed hover:bg-slate-900/5",
                    )}
                    style={{
                      left: `${overlay.box.x * 100}%`,
                      top: `${overlay.box.y * 100}%`,
                      width: `${overlay.box.w * 100}%`,
                      height: `${overlay.box.h * 100}%`,
                      borderColor: overlay.active ? undefined : LEVEL_STYLES[overlay.level].hex,
                      backgroundColor: overlay.active ? undefined : `${LEVEL_STYLES[overlay.level].hex}1f`,
                    }}
                  />
                ))
              : null}
          </div>
        </div>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
        <span className="truncate font-medium text-foreground">{document.name}</span>
        <span className="hidden sm:inline">
          {document.pages[pageNumber - 1]?.is_cover_page ? "Cover page (not a prescription)" : "Prescription page"}
        </span>
        <span className="ml-auto hidden sm:inline">
          Detected fields highlighted by confidence: {activeFieldId ? "1 selected" : "click to focus"}
        </span>
      </div>
    </div>
  );
}
