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
    const id = window.setInterval(() => setTick((t) => (t + 1 >= LOOP_AT ? 0 : t + 1)), 750);
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
    el.style.transform = `perspective(1200px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg)`;
  };

  const onLeave = () => {
    setPaused(false);
    if (tiltRef.current) tiltRef.current.style.transform = "perspective(1200px) rotateX(0deg) rotateY(0deg)";
  };

  const push = () => {
    if (ready) setTick(PUSHING_AT);
  };

  return (
    <div className="relative mx-auto mt-4 max-w-5xl">
      {/* Soft ambient glow */}
      <div className="pointer-events-none absolute -inset-8 rounded-[2rem] bg-[radial-gradient(ellipse_at_center,rgba(26,61,64,0.35),transparent_70%)] blur-2xl" />

      {/* Floating chips */}
      <div
        className={cn(
          "pointer-events-none absolute -top-3 right-6 z-10 hidden items-center gap-2 rounded-full border border-emerald-500/30 bg-[#0E0E0E]/95 px-3 py-1.5 text-xs font-medium text-emerald-300 shadow-xl backdrop-blur transition-all duration-500 lg:flex",
          extracted >= 4 ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        )}
      >
        <span className="animate-float motion-reduce:animate-none">
          <ShieldCheck className="h-3.5 w-3.5" />
        </span>
        DIN verified · Health Canada
      </div>
      <div
        className="pointer-events-none absolute -left-2 bottom-20 z-10 hidden animate-float items-center gap-2 rounded-full border border-[#C45C26]/35 bg-[#0E0E0E]/95 px-3 py-1.5 text-xs font-medium text-[#E8A882] shadow-xl backdrop-blur motion-reduce:animate-none lg:flex"
        style={{ animationDelay: "1.2s" }}
      >
        <FileText className="h-3.5 w-3.5" />
        Fax split · 3 pages
      </div>

      <div
        ref={tiltRef}
        onMouseMove={onMove}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={onLeave}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#111110] shadow-[0_40px_100px_-30px_rgba(0,0,0,0.7)] transition-transform duration-200 ease-out"
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          <span className="ml-3 text-xs text-white/40">Pharma Flow · Intake</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-white/45">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors",
                done ? "bg-emerald-400" : scanning ? "animate-pulse bg-[#C45C26]" : "bg-amber-400",
              )}
            />
            {done ? "Pushed to Kroll" : pushing ? "Typing into Kroll…" : scanning ? "Reading fax…" : "Ready to verify"}
          </span>
        </div>

        <div className="grid gap-0 md:grid-cols-5">
          <div className="border-r border-white/5 p-5 md:col-span-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Document</p>
            <div className="relative mt-3 aspect-[3/4] overflow-hidden rounded-lg bg-[#E8E4DC] p-4 shadow-inner">
              <div className="mb-3 h-2 w-1/2 rounded bg-[#0E0E0E]/15" />
              <div className="space-y-3">
                {rows.map((row, i) => (
                  <div
                    key={row.label}
                    className={cn(
                      "rounded-md p-1.5 ring-2 transition-all duration-500",
                      i < extracted
                        ? "bg-emerald-400/30 ring-emerald-600/50"
                        : i === extracted && scanning
                          ? "animate-pulse bg-[#C45C26]/25 ring-[#C45C26]/50"
                          : "ring-transparent",
                    )}
                  >
                    <div className="mb-1 h-1.5 w-1/6 rounded bg-[#0E0E0E]/15" />
                    <div className={cn("h-2.5 rounded bg-[#0E0E0E]/25", row.bar)} />
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                <div className="h-1.5 w-full rounded bg-[#0E0E0E]/10" />
                <div className="h-1.5 w-5/6 rounded bg-[#0E0E0E]/10" />
              </div>
              {scanning && (
                <div className="absolute inset-x-0 h-0.5 animate-scan-line bg-[#C45C26] shadow-[0_0_16px_4px_rgba(196,92,38,0.55)]" />
              )}
            </div>
          </div>

          <div className="space-y-3 p-5 md:col-span-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Extracted fields</p>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums transition-colors duration-500",
                  extracted === rows.length
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-amber-500/15 text-amber-300",
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
                    "flex h-11 items-center justify-between rounded-lg border px-3 transition-colors duration-500",
                    filled ? "border-emerald-400/20 bg-white/[0.05]" : "border-white/5 bg-white/[0.02]",
                  )}
                >
                  <span className="text-xs text-white/40">{row.label}</span>
                  {filled ? (
                    <div className="flex items-center gap-2">
                      <span className="animate-word-in text-sm font-medium text-white">{row.value}</span>
                      <CheckCircle2 className="h-3.5 w-3.5 animate-pop-in text-emerald-400" />
                    </div>
                  ) : (
                    <div className="h-2.5 w-24 animate-pulse rounded bg-white/10" />
                  )}
                </div>
              );
            })}

            <div className="relative pt-1">
              {ready && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 top-1 animate-pulse-ring rounded-md bg-[#C45C26]/35 motion-reduce:animate-none"
                />
              )}
              <button
                type="button"
                onClick={push}
                disabled={!ready && !done && !pushing}
                className={cn(
                  "relative flex h-11 w-full items-center justify-center gap-2 rounded-full text-[13px] font-semibold transition-all duration-300 disabled:opacity-60",
                  done
                    ? "bg-emerald-600 text-white"
                    : "bg-[#C45C26] text-white hover:bg-[#A84C1F]",
                  ready && "hover:-translate-y-0.5",
                )}
              >
                {pushing && <Loader2 className="h-4 w-4 animate-spin" />}
                {done && <CheckCircle2 className="h-4 w-4 animate-pop-in" />}
                {done ? "Sent to Kroll" : pushing ? "Typing into Kroll…" : "Push to Kroll"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-[#0E0E0E]/45">
        Live demo · hover to pause · click Push when ready
      </p>
    </div>
  );
}
