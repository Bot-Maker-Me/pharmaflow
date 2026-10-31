import * as React from "react";

import { LevelIcon, ScoreChip } from "@/components/Confidence";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LEVEL_STYLES } from "@/lib/confidence";
import { cn } from "@/lib/utils";
import type { ConfidenceLevel } from "@/lib/types";

interface ConfidenceFieldProps {
  label: string;
  value: string;
  score: number;
  level: ConfidenceLevel;
  active?: boolean;
  multiline?: boolean;
  numeric?: boolean;
  onChange: (value: string) => void;
  onFocus?: () => void;
  hint?: React.ReactNode;
  className?: string;
}

export function ConfidenceField({
  label,
  value,
  score,
  level,
  active,
  multiline,
  numeric,
  onChange,
  onFocus,
  hint,
  className,
}: ConfidenceFieldProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-l-4 bg-card p-3 transition-all",
        LEVEL_STYLES[level].border,
        active ? "ring-2 ring-primary/50" : "ring-0",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Label className="truncate">{label}</Label>
        <span className="flex shrink-0 items-center gap-1">
          <LevelIcon level={level} />
          <ScoreChip level={level} score={score} />
        </span>
      </div>

      {multiline ? (
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          className="min-h-[62px] resize-y"
        />
      ) : (
        <Input
          value={value}
          inputMode={numeric ? "numeric" : undefined}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
        />
      )}

      {hint ? <div className="mt-1.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
