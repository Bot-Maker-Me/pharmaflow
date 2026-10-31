import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { LEVEL_STYLES, formatPercent } from "@/lib/confidence";
import { cn } from "@/lib/utils";
import type { ConfidenceLevel } from "@/lib/types";

export function LevelIcon({ level, className }: { level: ConfidenceLevel; className?: string }) {
  const Icon = level === "high" ? CheckCircle2 : level === "medium" ? AlertTriangle : XCircle;
  return <Icon className={cn("h-4 w-4 shrink-0", LEVEL_STYLES[level].text, className)} />;
}

export function ScoreChip({
  level,
  score,
  className,
}: {
  level: ConfidenceLevel;
  score: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        LEVEL_STYLES[level].chip,
        className,
      )}
    >
      {formatPercent(score)}
    </span>
  );
}

export function StatusDot({ className }: { className?: string }) {
  return <span className={cn("inline-block h-2 w-2 rounded-full", className)} />;
}

export function ConfidenceLegend({ className }: { className?: string }) {
  const rows: Array<{ level: ConfidenceLevel; title: string; detail: string }> = [
    {
      level: "high",
      title: "High confidence",
      detail: "> 90% and DIN verified against the DPD",
    },
    {
      level: "medium",
      title: "Quick check",
      detail: "70–90%, or a missing licence / unverified DIN",
    },
    {
      level: "low",
      title: "Low confidence",
      detail: "< 70% or illegible handwriting flagged",
    },
  ];
  return (
    <div className={cn("space-y-2.5", className)}>
      {rows.map((row) => (
        <div key={row.level} className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              LEVEL_STYLES[row.level].soft,
            )}
          >
            <LevelIcon level={row.level} className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">{row.title}</p>
            <p className="text-xs text-muted-foreground">{row.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ScoreBar({ score, level }: { score: number; level: ConfidenceLevel }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full", LEVEL_STYLES[level].dot)}
        style={{ width: `${Math.max(4, Math.round(score * 100))}%` }}
      />
    </div>
  );
}
