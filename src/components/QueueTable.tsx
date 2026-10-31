import { ArrowUpRight, FlaskConical, ShieldAlert } from "lucide-react";

import { LevelIcon, ScoreChip } from "@/components/Confidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS_STYLES, scriptLevel } from "@/lib/confidence";
import { cn } from "@/lib/utils";
import type { Script } from "@/lib/types";

export function QueueTable({
  scripts,
  onOpen,
  compact = false,
}: {
  scripts: Script[];
  onOpen: (scriptId: string) => void;
  compact?: boolean;
}) {
  if (!scripts.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No prescriptions in this view yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Patient</TableHead>
          <TableHead>Prescription</TableHead>
          <TableHead>DIN</TableHead>
          <TableHead>Confidence</TableHead>
          {compact ? null : <TableHead>Status</TableHead>}
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {scripts.map((script) => {
          const level = scriptLevel(script);
          const statusMeta = STATUS_STYLES[script.status];
          const primary = script.medications[0];
          const hasDinIssue = script.medications.some(
            (med) => med.din_status === "unverified" || med.din_status === "invalid",
          );
          const hasCompound = script.medications.some((med) => med.is_compound);

          return (
            <TableRow key={script.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <LevelIcon level={level} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {script.patient.full_name || "Unknown patient"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      DOB {script.patient.dob || "—"}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <p className="truncate text-sm text-foreground">{primary?.drug_name || "—"}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {primary ? `${primary.quantity} · ${primary.refills} refill(s)` : ""}
                  {script.medications.length > 1 ? ` · +${script.medications.length - 1} more` : ""}
                </p>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-muted-foreground">{primary?.din || "—"}</span>
                  {hasDinIssue ? <ShieldAlert className="h-3.5 w-3.5 text-amber-500" /> : null}
                  {hasCompound ? <FlaskConical className="h-3.5 w-3.5 text-violet-500" /> : null}
                </div>
              </TableCell>
              <TableCell>
                <ScoreChip level={level} score={script.overallConfidence} />
              </TableCell>
              {compact ? null : (
                <TableCell>
                  <Badge variant="outline" className={cn("gap-1.5", statusMeta.chip)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dot)} />
                    {statusMeta.label}
                  </Badge>
                </TableCell>
              )}
              <TableCell>
                <p className="truncate text-xs text-muted-foreground">{script.documentName}</p>
                <p className="text-[11px] text-muted-foreground">
                  Page {script.pageNumber}
                  {script.totalOnPage > 1 ? ` · ${script.indexOnPage + 1}/${script.totalOnPage}` : ""}
                </p>
              </TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" onClick={() => onOpen(script.id)}>
                  Review
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
