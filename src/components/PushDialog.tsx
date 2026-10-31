import * as React from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Loader2,
  MonitorSmartphone,
  Terminal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { buildKeystrokePlan, getPmsProfile, type KeystrokeStep } from "@/lib/pms";
import { buildHelperPayloads } from "@/lib/payload";
import { toPmsSig } from "@/lib/sig";
import type { PushOutcome } from "@/services/agent";
import type { Script } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

export function PushDialog({
  open,
  onOpenChange,
  script,
  onFinished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  script?: Script;
  onFinished?: (result: PushOutcome) => void;
}) {
  const { pushScript, settings, helperStatus } = useAppStore();
  const pushRef = React.useRef(pushScript);
  pushRef.current = pushScript;
  const finishedRef = React.useRef(onFinished);
  finishedRef.current = onFinished;

  const [steps, setSteps] = React.useState<KeystrokeStep[]>([]);
  const [progress, setProgress] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const [outcome, setOutcome] = React.useState<PushOutcome | null>(null);
  const [showPayload, setShowPayload] = React.useState(false);

  const scriptId = script?.id;
  const profile = getPmsProfile(settings.pms);

  const requests = React.useMemo(
    () => (script ? buildHelperPayloads(script, settings.pms) : []),
    [script, settings.pms],
  );

  React.useEffect(() => {
    if (!open || !scriptId) return;
    let cancelled = false;
    setSteps([]);
    setProgress(0);
    setOutcome(null);
    setRunning(true);

    pushRef
      .current(scriptId, (step, index, total) => {
        if (cancelled) return;
        setSteps((prev) => [...prev, step]);
        setProgress(Math.round(((index + 1) / total) * 100));
      })
      .then((result) => {
        if (cancelled) return;
        setOutcome(result);
        setRunning(false);
        finishedRef.current?.(result);
      });

    return () => {
      cancelled = true;
    };
  }, [open, scriptId]);

  const viaHelper = outcome?.mode === "helper" || (running && helperStatus === "connected");

  return (
    <Dialog open={open} onOpenChange={(next) => (running ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorSmartphone className="h-5 w-5 text-primary" />
            Push to {profile.name}
          </DialogTitle>
          <DialogDescription>
            PharmFlow POSTs the verified prescription to the local helper, which replays it as keystrokes
            into the focused PMS window.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={profile.accent}>
            {profile.vendor}
          </Badge>
          <Badge variant="secondary" className="font-mono">
            target_system: {profile.targetSystem}
          </Badge>
          <Badge variant="secondary" className="font-mono">
            {profile.shortcut}
          </Badge>
          <Badge variant={viaHelper ? "success" : "warning"}>
            {viaHelper ? "POST /autofill" : "helper offline — simulated"}
          </Badge>
        </div>

        <Progress value={progress} />

        <div className="max-h-56 overflow-y-auto scrollbar-thin rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
          <p className="mb-2 flex items-center gap-1.5 text-slate-400">
            <Terminal className="h-3.5 w-3.5" /> pharmflow-helper · {settings.helperUrl}
          </p>
          {steps.length === 0 ? <p className="text-slate-500">Opening channel…</p> : null}
          {steps.map((step, index) => (
            <p key={`${step.id}-${index}`} className="animate-fade-in-up">
              <span className="text-emerald-400">→</span> {step.label}:{" "}
              <span className="text-slate-100">{step.value}</span>{" "}
              <span className="text-slate-500">[{step.keys}]</span>
            </p>
          ))}
          {outcome ? (
            <p className={cn("mt-2", outcome.ok ? "text-emerald-400" : "text-red-400")}>
              {outcome.ok ? "✓" : "✗"} {outcome.message}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setShowPayload((value) => !value)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-foreground"
          >
            {showPayload ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
            Keystroke payload contract · {requests.length} request
            {requests.length === 1 ? "" : "s"}
          </button>
          {showPayload ? (
            <pre className="max-h-48 overflow-auto scrollbar-thin border-t border-border bg-secondary/50 p-3 font-mono text-[11px] leading-relaxed text-foreground">
              {JSON.stringify(requests.length === 1 ? requests[0] : requests, null, 2)}
            </pre>
          ) : null}
        </div>

        {script && script.medications.length ? (
          <p className="text-[11px] text-muted-foreground">
            sig_text is sent in PMS Latin abbreviation form:{" "}
            <span className="font-mono text-foreground">{toPmsSig(script.medications[0].sig)}</span>{" "}
            (from “{script.medications[0].sig}”).
          </p>
        ) : null}

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            {running
              ? "Keystrokes are being written — do not touch the workstation."
              : "Verify the PMS entry screen before releasing the label."}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {running ? "Pushing…" : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
