import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "info";
}) {
  const toneClass = {
    default: "bg-secondary text-foreground",
    success: "bg-[#1F7A4D] text-white",
    warning: "bg-pf-amber text-pf-ink",
    info: "bg-pf-ink text-pf-sheet dark:bg-secondary dark:text-foreground",
  }[tone];

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pf-eyebrow text-muted-foreground">{label}</p>
          <p className="pf-display mt-2 text-[44px] tabular-nums text-foreground">{value}</p>
          {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center", toneClass)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </Card>
  );
}
