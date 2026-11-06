import { useEffect, useState } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

interface Field {
  label: string;
  value: string;
  /** What the tech actually sees handwritten or printed on the fax. */
  fax?: string;
  /** Where the value came from when it is not on the page. */
  source?: string;
}

const fields: Field[] = [
  { label: "Patient", value: "Whitfield, Eleanor", fax: "Eleanor Whitfield" },
  { label: "Date of birth", value: "1957-02-03", fax: "DOB 1957-02-03" },
  { label: "Drug", value: "Apo-Metformin 500 mg", fax: "Metformin 500 mg" },
  { label: "DIN", value: "00226514", source: "Health Canada drug database" },
  { label: "Quantity and refills", value: "60, 3 refills", fax: "#60  refills x3" },
  { label: "Directions", value: "1 tab by mouth twice daily", fax: "1 tab BID" },
];

const keystrokes = [
  { key: "F3", text: "Whitfield, Eleanor" },
  { key: "F5", text: "00226514" },
  { key: "F7", text: "1 TAB PO BID" },
];

const EXTRACT_FROM = 1;
const READY_AT = fields.length + EXTRACT_FROM + 1;
const PUSH_AT = READY_AT + 2;
const DONE_AT = PUSH_AT + keystrokes.length + 1;
const LOOP_AT = DONE_AT + 4;

function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M3 8.5l3.2 3L13 4.5" strokeLinecap="square" />
    </svg>
  );
}

export function HeroDemo() {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(reduced ? DONE_AT : 0);

  useEffect(() => {
    if (reduced) {
      setTick(DONE_AT);
      return;
    }
    const id = window.setInterval(() => setTick((t) => (t + 1 >= LOOP_AT ? 0 : t + 1)), 750);
    return () => window.clearInterval(id);
  }, [reduced]);

  const extracted = Math.max(0, Math.min(fields.length, tick - EXTRACT_FROM));
  const scanning = tick < READY_AT - 1;
  const ready = tick >= READY_AT && tick < PUSH_AT;
  const pushing = tick >= PUSH_AT && tick < DONE_AT;
  const done = tick >= DONE_AT;
  const typed = done ? keystrokes.length : Math.max(0, Math.min(keystrokes.length, tick - PUSH_AT + 1));
  const confidence = Math.round((96 * extracted) / fields.length);

  const status = done
    ? "Saved in Kroll"
    : pushing
      ? "Typing into Kroll"
      : ready
        ? "Waiting for your check"
        : "Reading the fax";

  return (
    <figure className="m-0" aria-label="Demo of a fax becoming a Kroll prescription">
      <div className="grid border-2 border-pf-ink bg-pf-sheet lg:grid-cols-[1.05fr_1fr_0.82fr]">
        {/* 1 — the fax */}
        <section className="border-b-2 border-pf-ink bg-[#F1F2EF] p-5 sm:p-6 lg:border-b-0 lg:border-r-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px] font-bold text-pf-ink">Fax received</h3>
            <span className="text-[13px] text-pf-slate">3 pages, using page 2</span>
          </div>

          <div className="relative mt-4 -rotate-[0.8deg] overflow-hidden border border-pf-rule bg-white px-5 pb-6 pt-4 shadow-[0_1px_0_#C5CDD1,0_18px_30px_-22px_rgba(16,20,24,0.45)]">
            <p className="font-data text-[11px] leading-snug text-pf-slate">
              Riverside Medical Clinic &nbsp; fax 604 555 0142 &nbsp; page 2 of 3
            </p>
            <p className="mt-3 font-display text-[3.25rem] font-black italic leading-none text-pf-ink/85">Rx</p>

            <div className="mt-2 space-y-1 font-hand text-[1.55rem] font-medium leading-[1.25] text-[#1F2A44]">
              {fields
                .filter((f) => f.fax)
                .map((f) => {
                  const idx = fields.indexOf(f);
                  const done_ = idx < extracted;
                  const current = idx === extracted && scanning;
                  return (
                    <p key={f.label} className="m-0">
                      <span
                        className={cn(
                          "box-decoration-clone px-1 transition-colors duration-300",
                          done_ ? "bg-pf-amber/45" : current ? "bg-pf-amber/20" : "bg-transparent",
                        )}
                      >
                        {f.fax}
                      </span>
                    </p>
                  );
                })}
            </div>

            <p className="mt-5 font-hand text-[1.7rem] font-semibold leading-none text-[#1F2A44]/80">M. Okafor</p>
            <p className="mt-1 font-data text-[10.5px] text-pf-slate">Dr. M. Okafor, licence on file</p>

            {scanning && (
              <div
                aria-hidden
                className="absolute inset-x-0 h-0.5 animate-scan-line bg-pf-amber shadow-[0_0_14px_2px_rgba(242,140,27,0.6)]"
              />
            )}
          </div>
        </section>

        {/* 2 — the fields */}
        <section className="flex flex-col border-b-2 border-pf-ink p-5 sm:p-6 lg:border-b-0 lg:border-r-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px] font-bold text-pf-ink">Fields to check</h3>
            <span className="text-[13px] tabular-nums text-pf-slate">{confidence}% sure</span>
          </div>

          <dl className="mt-3 flex-1">
            {fields.map((f, i) => {
              const filled = i < extracted;
              return (
                <div
                  key={f.label}
                  className="flex min-h-[3.1rem] items-center justify-between gap-4 border-b border-pf-rule py-2"
                >
                  <dt className="text-[13px] text-pf-slate">{f.label}</dt>
                  <dd className="m-0 flex items-center gap-2 text-right">
                    {filled ? (
                      <>
                        <span>
                          <span className="block text-[14px] font-semibold leading-tight text-pf-ink">{f.value}</span>
                          {f.source && <span className="block text-[11.5px] leading-tight text-pf-slate">{f.source}</span>}
                        </span>
                        <Check className="h-3.5 w-3.5 shrink-0 text-pf-ink" />
                      </>
                    ) : (
                      <span aria-hidden className="block h-2 w-20 bg-pf-rule" />
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>

          <button
            type="button"
            disabled={!ready}
            onClick={() => ready && setTick(PUSH_AT)}
            className={cn(
              "mt-4 flex h-12 w-full items-center justify-center gap-2 border-2 border-pf-ink text-[14px] font-bold text-pf-ink transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pf-ink",
              ready ? "bg-pf-amber hover:bg-[#FF9C2E]" : done ? "bg-pf-ink text-pf-sheet" : "bg-pf-sheet text-pf-slate",
            )}
          >
            {done && <Check className="h-4 w-4" />}
            {done ? "Sent to Kroll" : pushing ? "Typing into Kroll" : ready ? "Looks right, send to Kroll" : "Reading the fax"}
          </button>
        </section>

        {/* 3 — Kroll */}
        <section className="bg-pf-ink p-5 text-pf-sheet sm:p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px] font-bold">Kroll</h3>
            <span className="flex items-center gap-2 text-[13px] text-pf-sheet/70">
              <span
                aria-hidden
                className={cn("h-2 w-2 rounded-full", done ? "bg-pf-phosphor" : pushing ? "bg-pf-amber" : "bg-pf-sheet/30")}
              />
              {status}
            </span>
          </div>

          <div className="mt-4 min-h-[15rem] border border-pf-sheet/15 bg-black/40 p-4 font-data text-[13px] leading-[1.9] text-pf-phosphor">
            <p className="text-pf-sheet/55">New prescription</p>
            {keystrokes.map((k, i) => (
              <p key={k.key} className={cn("m-0 transition-opacity", i < typed ? "opacity-100" : "opacity-0")}>
                <span className="mr-3 inline-block w-6 text-pf-amber">{k.key}</span>
                {k.text}
              </p>
            ))}
            <p className={cn("m-0 mt-2 text-pf-sheet transition-opacity", done ? "opacity-100" : "opacity-0")}>
              Saved. Ready to fill.
            </p>
            {!done && (
              <span aria-hidden className="mt-1 inline-block h-4 w-2 animate-pulse bg-pf-phosphor motion-reduce:animate-none" />
            )}
          </div>
        </section>
      </div>

      <figcaption className="mt-3 text-[13px] text-pf-slate">
        Live demo with made-up patient data. It reads, waits for a person, then types.
      </figcaption>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
    </figure>
  );
}
