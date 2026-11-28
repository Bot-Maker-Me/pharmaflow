import * as React from "react";
import { CheckCircle2, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { patientLookup, type KrollStep } from "@/lib/payload";
import { toPmsSig } from "@/lib/sig";
import type { Script } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

interface StepDef {
  id: KrollStep;
  title: string;
  hint: string;
  value: (script: Script) => string;
}

const STEPS: StepDef[] = [
  {
    id: "patient",
    title: "1. Find the patient",
    hint: "Types the name in Patient Search and opens All Rxs. Check the name and date of birth in Kroll. Find the drug and press Y, or Enter if it is not there.",
    value: (s) => patientLookup(s.patient),
  },
  {
    id: "doctor",
    title: "2. Set the doctor",
    hint: "Types the licence number in the Doctor box (F7). Check the doctor's name in Kroll.",
    value: (s) => s.prescriber.license_number,
  },
  {
    id: "drug",
    title: "3. New drug (only if it was not in the history)",
    hint: "Opens the drug search with the drug name from the fax. Pick the product in Kroll.",
    value: (s) => [s.medications[0]?.drug_name, s.medications[0]?.strength].filter(Boolean).join(" "),
  },
  {
    id: "sig",
    title: "4. Sig",
    hint: "First click the Sig box in Kroll, then press this. It pastes the sig into that box.",
    value: (s) => toPmsSig(s.medications[0]?.sig ?? ""),
  },
  {
    id: "qty",
    title: "5. Quantity",
    hint: "First click the Disp Qty box in Kroll, then press this. It types the quantity into that box.",
    value: (s) => String(s.medications[0]?.quantity ?? ""),
  },
];

export function KrollGuidedDialog({
  open,
  onOpenChange,
  script,
  onFinished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  script?: Script;
  onFinished?: () => void;
}) {
  const { sendKrollStep, openKrollFax, completeKrollPush, helperStatus } = useAppStore();
  const [openRes, setOpenRes] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [auto, setAuto] = React.useState(false);
  const [busy, setBusy] = React.useState<KrollStep | null>(null);
  const [results, setResults] = React.useState<Partial<Record<KrollStep, { ok: boolean; message: string }>>>({});

  React.useEffect(() => {
    if (open) {
      setResults({});
      setBusy(null);
      setOpenRes(null);
    }
  }, [open, script?.id]);

  if (!script) return null;
  const offline = helperStatus !== "connected";

  const run = async (step: KrollStep) => {
    setBusy(step);
    const result = await sendKrollStep(script.id, step);
    setResults((prev) => ({ ...prev, [step]: result }));
    setBusy(null);
  };

  const isFax = Boolean(script.faxReceived);

  /** One button: open the fax in Kroll (clears it from Pending), then type the patient and the doctor. Stops at the first problem. */
  const runAuto = async () => {
    setAuto(true);
    setResults({});
    const opened = await openKrollFax(script.id);
    setOpenRes(opened);
    if (opened.ok) {
      for (const step of ["patient", "doctor"] as KrollStep[]) {
        setBusy(step);
        const r = await sendKrollStep(script.id, step);
        setResults((prev) => ({ ...prev, [step]: r }));
        setBusy(null);
        if (!r.ok) break;
      }
    }
    setAuto(false);
  };

  const finish = () => {
    completeKrollPush(script.id);
    onFinished?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enter into Kroll</DialogTitle>
          <DialogDescription>
            For a fax, press Do it first (or open the Rx Dropoff Form in Kroll yourself). Then press each step in order. PharmFlow brings Kroll to the front and
            types that step.
          </DialogDescription>
        </DialogHeader>

        <div className="border-2 border-foreground bg-secondary/40 p-3 text-sm">
          <p className="font-semibold">{script.patient.full_name || "Unknown patient"}</p>
          <p className="font-data text-xs text-muted-foreground">
            Date of birth on the fax: <span className="font-semibold text-foreground">{script.patient.dob || "not read"}</span>
            {" - "}it must match the date of birth in Kroll.
          </p>
        </div>

        {isFax ? (
          <div className="border-2 border-foreground p-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Open the fax in Kroll for me</p>
                <p className="text-[11px] text-muted-foreground">
                  Kroll must be on Inbound Docs (Show: Pending). PharmFlow selects this fax, presses F2, picks "Use to process
                  prescription(s)" and Process, then types the patient and the doctor. Do not touch the mouse while it runs.
                </p>
              </div>
              <Button size="sm" disabled={!!busy || auto || offline} onClick={() => void runAuto()}>
                {auto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Do it
              </Button>
            </div>
            {openRes ? (
              <p className={cn("mt-1 text-[11px]", openRes.ok ? "text-[#1F7A4D]" : "text-destructive")}>
                {openRes.ok ? "✓" : "✗"} {openRes.message}
              </p>
            ) : null}
          </div>
        ) : null}

        {offline ? (
          <p className="border-2 border-destructive bg-destructive/10 p-2 text-xs text-destructive">
            The desktop helper is offline on this PC. Check Settings, then try again.
          </p>
        ) : null}

        <div className="space-y-2">
          {STEPS.map((step) => {
            const value = step.value(script);
            const result = results[step.id];
            return (
              <div key={step.id} className="border border-border p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{step.title}</p>
                    <p className="font-data truncate text-xs">{value || "nothing to type"}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={result?.ok ? "outline" : "default"}
                    disabled={!!busy || offline || !value}
                    onClick={() => void run(step.id)}
                  >
                    {busy === step.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : result?.ok ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {result?.ok ? "Again" : "Type it"}
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{step.hint}</p>
                {result ? (
                  <p className={cn("mt-1 text-[11px]", result.ok ? "text-[#1F7A4D]" : "text-destructive")}>
                    {result.ok ? "✓" : "✗"} {result.message}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            Check the patient notes in Kroll before you add the Rx. Press Add in Kroll yourself, then press Finished.
          </p>
          <Button onClick={finish} disabled={!!busy}>
            <CheckCircle2 className="h-4 w-4" /> Finished in Kroll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
