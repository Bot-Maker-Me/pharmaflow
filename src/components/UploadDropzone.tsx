import * as React from "react";
import { FilePlus2, FileScan, Loader2, Sparkles, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  onFiles: (files: File[]) => void;
  onLoadSample: () => void;
  busy: boolean;
}

export function UploadDropzone({ onFiles, onLoadSample, busy }: UploadDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    onFiles(Array.from(fileList));
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
      className={cn(
        "relative overflow-hidden rounded-xl border-2 border-dashed bg-card p-6 transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/tiff,image/webp"
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="flex flex-col items-center gap-3 text-center">
        <span
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-2xl transition-colors",
            dragging ? "bg-primary text-primary-foreground" : "bg-secondary text-primary",
          )}
        >
          <UploadCloud className="h-6 w-6" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">
            Drop faxed prescriptions here
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Multi-page PDF faxes and photos/scans (PNG, JPG, TIFF, WebP)
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
            {busy ? "Processing…" : "Browse files"}
          </Button>
          <Button variant="outline" onClick={onLoadSample} disabled={busy}>
            <Sparkles className="h-4 w-4" />
            Load sample fax
          </Button>
        </div>

        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileScan className="h-3.5 w-3.5" />
          Cover pages are detected and split from prescription pages automatically.
        </p>
      </div>

      {dragging ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 animate-sweep bg-gradient-to-b from-primary/20 to-transparent" />
      ) : null}
    </div>
  );
}
