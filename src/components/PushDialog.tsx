import * as React from "react";
import { CheckCircle2, Loader2, MonitorSmartphone, Terminal } from "lucide-react";

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
import { getPmsProfile, type KeystrokeStep } from "@/lib/pms";
import type { PushResult } from "@/services/agent";
import type { Script } from "@/lib/types";
import { useAppStore } from "@/store/app-store";

export function PushDialog({
  open,
  onOpenChange,
  script,
  onFinished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  script?: Script;
  onFinished?: (result: PushResult) => void;
}) {
  const { pushScript, settings, agentStatus } = useAppStore();
  const pushRef = React.useRef(pushScript);
  pushRef.current = pushScript;
  const finishedRef = React.useRef(onFinished);
  finishedRef.current = onFinished;

  const [steps, setSteps] = React.useState<KeystrokeStep[]>([]);
  const [progress, setProgress] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<PushResult | null>(null);

  const scriptId = script?.id;
  const profile = getPmsProfile(settings.pms);

  React.useEffect(() => {
    if (!open || !scriptId) return;
    let cancelled = false;
    setSteps([]);
    setProgress(0);
    setResult(null);
    setRunning(true);

    pushRef
      .current(scriptId, (step, index, total) => {
        if (cancelled) return;
        setSteps((prev) => [...prev, step]);
        setProgress(Math.round(((index + 1) / total) * 100));
      })
      .then((pushed) => {
        if (cancelled) return;
        setResult(pushed);
        setRunning(false);
        finishedRef.current?.(pushed);
      });

    return () => {
      cancelled = true;
    };
  }, [open, scriptId]);

  return (
    <Dialog open={open} onOpenChange={(next) => (running ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorSmartphone className="h-5 w-5 text-primary" />
            Push to {profile.name}
          </DialogTitle>
          <DialogDescription>
            PharmFlow is replaying the verified values as keystrokes into the target Pharmacy Management
            System via the desktop helper.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={profile.accent}>
            {profile.vendor}
          </Badge>
          <Badge variant="secondary" className="font-mono">
            {profile.shortcut}
          </Badge>
          <Badge variant={agentStatus === "connected" ? "success" : "warning"}>
            {agentStatus === "connected" ? "Helper connected" : "Helper offline — simulated"}
          </Badge>
        </div>

        <Progress value={progress} />

        <div className="max-h-64 overflow-y-auto scrollbar-thin rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
          <p className="mb-2 flex items-center gap-1.5 text-slate-400">
            <Terminal className="h-3.5 w-3.5" /> pharmflow-helper · ws session
          </p>
          {steps.length === 0 ? <p className="text-slate-500">Opening channel…</p> : null}
          {steps.map((step, index) => (
            <p key={`${step.id}-${index}`} className="animate-fade-in-up">
              <span className="text-emerald-400">→</span> {step.label}:{" "}
              <span className="text-slate-100">{step.value}</span>{" "}
              <span className="text-slate-500">[{step.keys}]</span>
            </p>
          ))}
          {result ? (
            <p className="mt-2 text-emerald-400">
              ✓ Committed {steps.length} field writes · mode: {result.mode}
            </p>
          ) : null}
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            {running
              ? "Keystrokes are being written — do not touch the workstation."
              : "Verify the entry screen before releasing the label."}
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
