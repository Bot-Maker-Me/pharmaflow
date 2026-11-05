import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { CheckCircle2, FileText, Loader2, ShieldCheck } from "lucide-react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

const rows = [
  { label: "Patient", value: "Eleanor Whitfield", bar: "w-3/4" },
  { label: "DOB", value: "1957-02-03", bar: "w-1/3" },
  { label: "Drug", value: "Apo-Metformin 500 mg", bar: "w-4/5" },
  { label: "DIN", value: "00226514", bar: "w-1/4" },
  { label: "Qty / Refills", value: "60 · 3", bar: "w-1/5" },
  { label: "SIG", value: "1 tab PO BID", bar: "w-2/5" },
];

const EXTRACT_FROM = 1;
const READY_AT = rows.length + EXTRACT_FROM + 1;
const PUSHING_AT = READY_AT + 2;
const DONE_AT = PUSHING_AT + 1;
const LOOP_AT = DONE_AT + 4;

export function HeroDemo() {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(reduced ? READY_AT : 0);
  const [paused, setPaused] = useState(false);
  const tiltRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced || paused) return;
    const id = window.setInterval(() => setTick((t) => (t + 1 >= LOOP_AT ? 0 : t + 1)), 800);
    return () => window.clearInterval(id);
  }, [reduced, paused]);

  const extracted = Math.max(0, Math.min(rows.length, tick - EXTRACT_FROM));
  const scanning = tick < READY_AT - 1;
  const ready = tick >= READY_AT && tick < PUSHING_AT;
  const pushing = tick >= PUSHING_AT && tick < DONE_AT;
  const done = tick >= DONE_AT;
  const confidence = Math.round((96 * extracted) / rows.length);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = tiltRef.current;
    if (!el || reduced) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(1200px) rotateX(${(-py * 4).toFixed(2)}deg) rotateY(${(px * 5).toFixed(2)}deg)`;
  };

  const onLeave = () => {
    setPaused(false);
    if (tiltRef.current) tiltRef.current.style.transform = "perspective(1200px) rotateX(0deg) rotateY(0deg)";
  };

  const push = () => {
    if (ready) setTick(PUSHING_AT);
  };

  return (
    <div className="relative mx-auto max-w-5xl">
      <div
        className={cn(
          "pointer-events-none absolute -top-3 right-4 z-10 hidden items-center gap-2 rounded-full border border-emerald-400/25 bg-[#0C0C0E] px-3 py-1.5 text-xs font-medium text-emerald-300 shadow-lg transition-opacity duration-500 lg:flex",
          extracted >= 4 ? "opacity-100" : "opacity-0",
        )}
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        DIN verified · Health Canada
      </div>
      <div className="pointer-events-none absolute -left-1 bottom-16 z-10 hidden items-center gap-2 rounded-full border border-cyan-400/25 bg-[#0C0C0E] px-3 py-1.5 text-xs font-medium text-cyan-200 shadow-lg lg:flex">
        <FileText className="h-3.5 w-3.5" />
        Fax split · 3 pages
      </div>

      <div
        ref={tiltRef}
        onMouseMove={onMove}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={onLeave}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#121214] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)] transition-transform duration-150 ease-out will-change-transform"
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          <span className="ml-3 text-xs text-white/40">Pharma Flow · Intake</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-white/45">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                done ? "bg-emerald-400" : scanning ? "bg-cyan-400" : "bg-amber-400",
              )}
            />
            {done ? "Pushed to Kroll" : pushing ? "Typing into Kroll…" : scanning ? "Reading fax…" : "Ready to verify"}
          </span>
        </div>

        <div className="grid gap-0 md:grid-cols-5">
          <div className="border-r border-white/5 p-5 md:col-span-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Document</p>
            <div className="relative mt-3 aspect-[3/4] overflow-hidden rounded-lg bg-[#E8E4DC] p-4">
              <div className="mb-3 h-2 w-1/2 rounded bg-[#0E0E0E]/15" />
              <div className="space-y-3">
                {rows.map((row, i) => (
                  <div
                    key={row.label}
                    className={cn(
                      "rounded-md p-1.5 ring-2 transition-colors duration-300",
                      i < extracted
                        ? "bg-emerald-400/25 ring-emerald-600/40"
                        : i === extracted && scanning
                          ? "bg-cyan-400/20 ring-cyan-500/40"
                          : "ring-transparent",
                    )}
                  >
                    <div className="mb-1 h-1.5 w-1/6 rounded bg-[#0E0E0E]/15" />
                    <div className={cn("h-2.5 rounded bg-[#0E0E0E]/25", row.bar)} />
                  </div>
                ))}
              </div>
              {scanning && (
                <div className="absolute inset-x-0 h-0.5 animate-scan-line bg-cyan-500 shadow-[0_0_12px_2px_rgba(34,211,238,0.5)]" />
              )}
            </div>
          </div>

          <div className="space-y-3 p-5 md:col-span-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Extracted fields</p>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums",
                  extracted === rows.length ? "bg-emerald-500/15 text-emerald-300" : "bg-cyan-500/15 text-cyan-200",
                )}
              >
                {confidence}% confidence
              </span>
            </div>

            {rows.map((row, i) => {
              const filled = i < extracted;
              return (
                <div
                  key={row.label}
                  className={cn(
                    "flex h-11 items-center justify-between rounded-lg border px-3 transition-colors duration-300",
                    filled ? "border-emerald-400/20 bg-white/[0.05]" : "border-white/5 bg-white/[0.02]",
                  )}
                >
                  <span className="text-xs text-white/40">{row.label}</span>
                  {filled ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{row.value}</span>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                  ) : (
                    <div className="h-2.5 w-24 rounded bg-white/10" />
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={push}
              disabled={!ready && !done && !pushing}
              className={cn(
                "mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-full text-[13px] font-semibold transition disabled:opacity-50",
                done ? "bg-emerald-500 text-white" : "bg-cyan-400 text-[#09090B] hover:bg-cyan-300",
              )}
            >
              {pushing && <Loader2 className="h-4 w-4 animate-spin" />}
              {done && <CheckCircle2 className="h-4 w-4" />}
              {done ? "Sent to Kroll" : pushing ? "Typing into Kroll…" : "Push to Kroll"}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-white/35">Interactive demo · hover to pause · click Push when ready</p>
    </div>
  );
}
