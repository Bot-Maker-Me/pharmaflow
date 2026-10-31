import * as React from "react";
import { ArrowLeft, ArrowRight, CheckCheck, FileWarning, Send, Sparkles } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { DocumentViewer, type ViewerOverlay } from "@/components/DocumentViewer";
import { PushDialog } from "@/components/PushDialog";
import { ScoreChip } from "@/components/Confidence";
import { ScriptWorkspace } from "@/components/ScriptWorkspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fieldLevel, scriptIssues, scriptLevel } from "@/lib/confidence";
import { getPmsProfile } from "@/lib/pms";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

export default function Verify() {
  const { scriptId } = useParams<{ scriptId?: string }>();
  const navigate = useNavigate();
  const { scripts, documents, settings, verifyScript } = useAppStore();

  const active =
    scripts.find((script) => script.id === scriptId) ??
    scripts.find((script) => script.status === "pending") ??
    scripts[0];

  const document = active ? documents.find((doc) => doc.id === active.documentId) : undefined;

  const [page, setPage] = React.useState(active?.pageNumber ?? 1);
  const [activeField, setActiveField] = React.useState<string | undefined>(undefined);
  const [pushOpen, setPushOpen] = React.useState(false);

  React.useEffect(() => {
    if (active) setPage(active.pageNumber);
  }, [active?.id, active?.pageNumber]);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        setPushOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const profile = getPmsProfile(settings.pms);

  if (!active || !document) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <FileWarning className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold">Nothing to verify</p>
            <p className="text-xs text-muted-foreground">
              Drop a faxed prescription on the intake page or load a sample fax to populate the queue.
            </p>
            <Button onClick={() => navigate("/")}>Go to intake</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pageScripts = scripts
    .filter((script) => script.documentId === active.documentId && script.pageNumber === page)
    .sort((a, b) => a.indexOnPage - b.indexOnPage);

  const activeIndex = scripts.findIndex((script) => script.id === active.id);
  const nextScript = scripts[activeIndex + 1];
  const previousScript = scripts[activeIndex - 1];
  const issues = scriptIssues(active);
  const level = scriptLevel(active);

  // Overlays only make sense for the page the active script was read from.
  const onScriptPage = active.pageNumber === page;
  const overlays: ViewerOverlay[] = [];
  if (onScriptPage && active.patient.bbox) {
    overlays.push({
      id: "patient.full_name",
      box: active.patient.bbox,
      level: fieldLevel(active.patient.confidence),
      label: `Patient: ${active.patient.full_name}`,
      active: activeField === "patient.full_name",
    });
  }
  if (onScriptPage && active.prescriber.bbox) {
    overlays.push({
      id: "prescriber.name",
      box: active.prescriber.bbox,
      level: fieldLevel(active.prescriber.confidence, {
        requiresCheck: !active.prescriber.license_number.trim(),
      }),
      label: `Prescriber: ${active.prescriber.name}`,
      active: activeField === "prescriber.name",
    });
  }
  active.medications.forEach((medication, index) => {
    if (!medication.bbox || !onScriptPage) return;
    overlays.push({
      id: `med.${medication.id}`,
      box: medication.bbox,
      level: medication.confidence >= 0.9 ? "high" : medication.confidence >= 0.7 ? "medium" : "low",
      label: `Medication ${index + 1}: ${medication.drug_name}`,
      active: activeField === `med.${medication.id}`,
    });
  });

  const pushCompletedRef = React.useRef(false);

  // Auto-advance only once the technician dismisses the keystroke trace, so the
  // dialog never re-fires against the next script.
  const handlePushDialogChange = (next: boolean) => {
    setPushOpen(next);
    if (next || !pushCompletedRef.current) return;
    pushCompletedRef.current = false;
    if (!settings.autoAdvance) return;
    const queue = scripts.filter((script) => script.status === "pending" && script.id !== active.id);
    if (queue.length) navigate(`/verify/${queue[0].id}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Select
            value={document.id}
            onValueChange={(value) => {
              const next = scripts.find((script) => script.documentId === value);
              if (next) navigate(`/verify/${next.id}`);
            }}
          >
            <SelectTrigger className="h-8 w-[240px] text-xs">
              <SelectValue placeholder="Select document" />
            </SelectTrigger>
            <SelectContent>
              {documents.map((doc) => (
                <SelectItem key={doc.id} value={doc.id}>
                  {doc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary">{document.pageCount} page(s)</Badge>
        </div>

        {pageScripts.length > 1 ? (
          <Tabs value={active.id} onValueChange={(value) => navigate(`/verify/${value}`)}>
            <TabsList>
              {pageScripts.map((script, index) => (
                <TabsTrigger key={script.id} value={script.id}>
                  Script {index + 1} of {pageScripts.length}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!previousScript}
            onClick={() => previousScript && navigate(`/verify/${previousScript.id}`)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!nextScript}
            onClick={() => nextScript && navigate(`/verify/${nextScript.id}`)}
          >
            Next
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <DocumentViewer
            document={document}
            pageNumber={page}
            onPageChange={(next) => {
              setPage(next);
              const firstOnPage = scripts.find(
                (script) => script.documentId === document.id && script.pageNumber === next,
              );
              if (firstOnPage) navigate(`/verify/${firstOnPage.id}`);
            }}
            overlays={overlays}
            onSelectField={setActiveField}
            activeFieldId={activeField}
          />
        </div>

        <div className="flex w-full max-w-[540px] shrink-0 flex-col border-l border-border bg-secondary/30">
          <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold text-foreground">AI extraction — edit before pushing</p>
            <ScoreChip level={level} score={active.overallConfidence} className="ml-auto" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-4">
            <ScriptWorkspace script={active} activeField={activeField} onFocusField={setActiveField} />
          </div>

          <div className="shrink-0 space-y-3 border-t border-border bg-card p-3">
            {issues.length ? (
              <p className="text-[11px] text-amber-700">
                {issues.length} item(s) still need confirmation — pushing is allowed but flagged in the
                audit trail.
              </p>
            ) : (
              <p className="text-[11px] text-emerald-700">
                All fields verified against the DPD and provincial licence data.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => verifyScript(active.id)}
                disabled={active.status !== "pending"}
              >
                <CheckCheck className="h-4 w-4" />
                {active.status === "pending" ? "Verify & approve" : "Verified"}
              </Button>
              <Button
                variant="success"
                className="flex-1"
                onClick={() => setPushOpen(true)}
                disabled={active.status === "pushed"}
              >
                <Send className="h-4 w-4" />
                Push to {profile.name}
                <span className={cn("ml-1 rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px]")}>
                  {profile.shortcut}
                </span>
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {active.status === "pushed"
                ? `Pushed ${active.pushedAt ? new Date(active.pushedAt).toLocaleTimeString() : ""} to ${getPmsProfile(active.pushedTo ?? settings.pms).name}.`
                : "The desktop helper replays each field into the open PMS entry window."}
            </p>
          </div>
        </div>
      </div>

      <PushDialog
        open={pushOpen}
        onOpenChange={handlePushDialogChange}
        script={active}
        onFinished={() => {
          pushCompletedRef.current = true;
        }}
      />
    </div>
  );
}
