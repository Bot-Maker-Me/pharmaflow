import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * High-contrast editorial landing — Stratum scale + Villa restraint.
 * Not plain paper. Not purple SaaS.
 *
 * Paper  #F4F1EA
 * Ink    #0E0E0E
 * Clay   #C45C26  (Stratum-style accent CTA)
 * Forest #1A3D40
 * Warm grey sections for rhythm
 */

const nav = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#safety", label: "Safety" },
  { href: "#pricing", label: "Pricing" },
];

const steps = [
  {
    n: "01",
    title: "Drop the fax",
    body: "Multi-page PDF or photo. Cover sheets split automatically.",
  },
  {
    n: "02",
    title: "Fields fill in",
    body: "Patient, doctor, DIN, qty, SIG — structured in seconds.",
  },
  {
    n: "03",
    title: "Verify once",
    body: "Side-by-side review. DIN checked against Health Canada.",
  },
  {
    n: "04",
    title: "Push to Kroll",
    body: "Local agent types F3 / F5 / F7. Same workflow, less typing.",
  },
];

const principles = [
  {
    title: "Clinical engines stay in Kroll",
    body: "No DUR. No allergy engine. No interaction checks. Pharma Flow only moves intake data.",
  },
  {
    title: "One pharmacy. Zero bleed.",
    body: "Row-level isolation. Your queue, learnings, and agent keys never mix with another store.",
  },
  {
    title: "Built for Canadian independents",
    body: "Kroll, Propel Rx, WinRx. Banner and community stores. Canada-central data options.",
  },
];

const pricingLines = [
  "Unlimited intake on the pilot workstation",
  "Extraction + DIN verification",
  "Kroll · Propel Rx · WinRx profiles",
  "Local Windows agent",
  "14-day pilot — no card",
];

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("scroll-smooth");
    return () => root.classList.remove("scroll-smooth");
  }, []);

  return (
    <div className="min-h-screen bg-[#F4F1EA] text-[#0E0E0E] antialiased selection:bg-[#C45C26]/20">
      {/* Nav */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled
            ? "border-b border-[#0E0E0E]/10 bg-[#F4F1EA]/95 backdrop-blur-md"
            : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-[78rem] items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[4px] bg-[#0E0E0E] text-[11px] font-bold tracking-[0.14em] text-[#F4F1EA]">
              PF
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Pharma Flow</span>
          </Link>

          <nav className="hidden items-center gap-10 text-[13px] font-medium text-[#0E0E0E]/65 md:flex">
            {nav.map((item) => (
              <a key={item.href} href={item.href} className="transition hover:text-[#0E0E0E]">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="hidden text-[13px] font-medium text-[#0E0E0E]/65 transition hover:text-[#0E0E0E] sm:inline"
            >
              Sign in
            </Link>
            <Link
              to="/login"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0E0E0E] px-5 text-[13px] font-semibold text-[#F4F1EA] transition hover:bg-[#222]"
            >
              Start pilot
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO — Stratum-scale type ── */}
      <section className="relative overflow-hidden pt-28 pb-8 sm:pt-36 sm:pb-12">
        <div className="mx-auto max-w-[78rem] px-5 sm:px-8">
          <p className="text-[12px] font-semibold uppercase tracking-[0.24em] text-[#C45C26]">
            Canadian independent pharmacies
          </p>

          <h1 className="mt-6 max-w-[18ch] text-[3.25rem] font-bold leading-[0.95] tracking-[-0.045em] text-[#0E0E0E] sm:text-[4.75rem] lg:text-[6rem]">
            Stop typing.
            <br />
            <span className="text-[#0E0E0E]/35">Start verifying.</span>
          </h1>

          <div className="mt-10 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <p className="max-w-md text-[1.125rem] leading-relaxed text-[#0E0E0E]/65">
              Pharma Flow turns faxed prescriptions into structured fields, lets staff confirm once,
              then enters them into Kroll — reclaiming 6–8 hours of typing every day.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/login"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-[#C45C26] px-8 text-[14px] font-semibold text-white transition hover:bg-[#A84C1F]"
              >
                Start 14-day pilot
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex h-12 items-center rounded-full border border-[#0E0E0E]/2 px-6 text-[14px] font-semibold transition hover:border-[#0E0E0E]/5"
              >
                See the flow
              </a>
            </div>
          </div>
        </div>

        {/* Product stage — full width under hero copy */}
        <div className="mx-auto mt-14 max-w-[78rem] px-5 sm:mt-20 sm:px-8">
          <div className="overflow-hidden rounded-2xl border border-[#0E0E0E]/10 bg-[#0E0E0E] shadow-[0_40px_100px_-40px_rgba(14,14,14,0.55)]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                <span className="ml-3 text-[12px] text-white/45">Pharma Flow · Verification</span>
              </div>
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                Ready
              </span>
            </div>
            <div className="grid lg:grid-cols-2">
              <div className="border-b border-white/10 bg-[#161616] p-6 sm:p-8 lg:border-b-0 lg:border-r">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
                  Source fax
                </p>
                <div className="mt-6 space-y-3 rounded-lg bg-[#1C1C1C] p-5 ring-1 ring-white/5">
                  {[92, 78, 65, 88, 54, 72, 60].map((w, i) => (
                    <div
                      key={i}
                      className="h-2.5 rounded-sm bg-white/[0.08]"
                      style={{ width: `${w}%` }}
                    />
                  ))}
                  <div className="mt-4 flex gap-2">
                    <div className="h-16 flex-1 rounded bg-white/[0.04] ring-1 ring-white/5" />
                    <div className="h-16 w-20 rounded bg-white/[0.04] ring-1 ring-white/5" />
                  </div>
                </div>
              </div>
              <div className="bg-[#111] p-6 sm:p-8">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
                  Extracted fields
                </p>
                <dl className="mt-6 space-y-0">
                  {[
                    ["Patient", "Eleanor Whitfield"],
                    ["DOB", "1957-02-03"],
                    ["Drug", "Apo-Metformin 500 mg"],
                    ["DIN", "00226514"],
                    ["Qty / Refills", "60 · 3"],
                    ["SIG", "1 tab PO BID with food"],
                  ].map(([k, v], i) => (
                    <div
                      key={k}
                      className={cn(
                        "flex items-baseline justify-between gap-4 py-3.5",
                        i < 5 && "border-b border-white/[0.06]",
                      )}
                    >
                      <dt className="text-[13px] text-white/40">{k}</dt>
                      <dd className="text-right text-[14px] font-medium text-white">{v}</dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#C45C26] text-[13px] font-semibold text-white"
                >
                  Push to Kroll
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          <p className="mt-4 text-center text-[12px] text-[#0E0E0E]/4">
            Illustrative UI — no live patient data shown
          </p>
        </div>
      </section>

      {/* Metrics — ink band */}
      <section className="border-y border-[#0E0E0E] bg-[#0E0E0E] text-[#F4F1EA]">
        <div className="mx-auto grid max-w-[78rem] grid-cols-2 gap-8 px-5 py-14 sm:grid-cols-4 sm:px-8 sm:py-16">
          {[
            { v: "6–8h", l: "Saved per tech / day" },
            { v: "2–3s", l: "Extraction time" },
            { v: "100%", l: "Store isolation" },
            { v: "$199", l: "CAD / store / month" },
          ].map((s) => (
            <div key={s.l}>
              <p className="text-3xl font-bold tracking-tight sm:text-4xl">{s.v}</p>
              <p className="mt-2 text-[13px] text-white/45">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Problem — big type */}
      <section id="product" className="scroll-mt-24 py-24 sm:py-32">
        <div className="mx-auto max-w-[78rem] px-5 sm:px-8">
          <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#C45C26]">
            The bottleneck
          </p>
          <h2 className="mt-5 max-w-[16ch] text-[2.5rem] font-bold leading-[1.05] tracking-[-0.035em] sm:text-[3.5rem]">
            Half the shift is still retyping the fax.
          </h2>
          <p className="mt-6 max-w-xl text-[1.1rem] leading-relaxed text-[#0E0E0E]/6">
            Patient. Prescriber. DIN. Quantity. SIG. Over and over into 15-year-old Windows software.
            Slow. Error-prone. Exhausting.
          </p>

          <div className="mt-16 grid gap-4 sm:grid-cols-3">
            {[
              {
                t: "Hours lost",
                b: "Technicians burn most of the day on the same fields for every script.",
              },
              {
                t: "Noisy pages",
                b: "Handwriting, fax compression, and cover sheets force constant re-work.",
              },
              {
                t: "Typing risk",
                b: "Wrong DIN or patient ID is a safety issue — not a software quirk.",
              },
            ].map((card, i) => (
              <div
                key={card.t}
                className={cn(
                  "rounded-2xl p-8 sm:p-10",
                  i === 1 ? "bg-[#0E0E0E] text-[#F4F1EA]" : "bg-white ring-1 ring-[#0E0E0E]/08",
                )}
              >
                <p className="font-mono text-[12px] opacity-40">0{i + 1}</p>
                <h3 className="mt-4 text-[1.25rem] font-bold tracking-tight">{card.t}</h3>
                <p
                  className={cn(
                    "mt-3 text-[14px] leading-relaxed",
                    i === 1 ? "text-white/55" : "text-[#0E0E0E]/55",
                  )}
                >
                  {card.b}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How — numbered large */}
      <section id="how" className="scroll-mt-24 bg-[#EBE7DE] py-24 sm:py-32">
        <div className="mx-auto max-w-[78rem] px-5 sm:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#C45C26]">
                Process
              </p>
              <h2 className="mt-4 text-[2.5rem] font-bold tracking-[-0.035em] sm:text-[3.25rem]">
                Fax in.
                <br />
                Kroll filled.
              </h2>
            </div>
            <p className="max-w-sm text-[15px] leading-relaxed text-[#0E0E0E]/55">
              Four steps. One human check. No new workflow for your staff — just less keyboard time.
            </p>
          </div>

          <ol className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <li
                key={step.n}
                className="rounded-2xl bg-[#F4F1EA] p-7 ring-1 ring-[#0E0E0E]/06"
              >
                <span className="text-[2rem] font-bold tracking-tight text-[#C45C26]">{step.n}</span>
                <h3 className="mt-4 text-[1.1rem] font-bold tracking-tight">{step.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[#0E0E0E]/55">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Safety */}
      <section id="safety" className="scroll-mt-24 py-24 sm:py-32">
        <div className="mx-auto max-w-[78rem] px-5 sm:px-8">
          <div className="grid gap-16 lg:grid-cols-[1fr_1.15fr] lg:gap-24">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#C45C26]">
                Guardrails
              </p>
              <h2 className="mt-4 text-[2.25rem] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[2.75rem]">
                Outside clinical decisioning. By design.
              </h2>
            </div>
            <div className="space-y-0">
              {principles.map((p, i) => (
                <div
                  key={p.title}
                  className={cn(
                    "border-t border-[#0E0E0E]/12 py-8",
                    i === principles.length - 1 && "border-b",
                  )}
                >
                  <h3 className="text-[1.15rem] font-bold">{p.title}</h3>
                  <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-[#0E0E0E]/55">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing — full dark */}
      <section id="pricing" className="scroll-mt-24 bg-[#0E0E0E] py-24 text-[#F4F1EA] sm:py-32">
        <div className="mx-auto max-w-[78rem] px-5 sm:px-8">
          <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#C45C26]">
                Pricing
              </p>
              <h2 className="mt-4 text-[3.5rem] font-bold tracking-[-0.04em] sm:text-[5rem]">
                $199
              </h2>
              <p className="mt-1 text-[1.1rem] text-white/45">CAD per store / month</p>
              <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/55">
                One rate. Pilot first. Keep it only if the hours come back to the dispensary floor.
              </p>
              <Link
                to="/login"
                className="mt-10 inline-flex h-12 items-center gap-2 rounded-full bg-[#C45C26] px-8 text-[14px] font-semibold text-white transition hover:bg-[#A84C1F]"
              >
                Start free pilot
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <ul className="space-y-1 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
              {pricingLines.map((line) => (
                <li
                  key={line}
                  className="flex items-center gap-3 rounded-xl px-5 py-4 text-[14px] text-white/80"
                >
                  <Check className="h-4 w-4 shrink-0 text-[#C45C26]" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Final CTA band */}
      <section className="border-t border-[#0E0E0E]/1 bg-[#F4F1EA] py-20 sm:py-24">
        <div className="mx-auto max-w-[78rem] px-5 text-center sm:px-8">
          <h2 className="text-[2.25rem] font-bold tracking-[-0.03em] sm:text-[3rem]">
            Give the keyboard back to the pharmacy.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[15px] text-[#0E0E0E]/55">
            14 days on one workstation. No card. Delete anytime.
          </p>
          <Link
            to="/login"
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-[#0E0E0E] px-8 text-[14px] font-semibold text-[#F4F1EA] transition hover:bg-[#222]"
          >
            Start the pilot
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-[#0E0E0E]/1 bg-[#EBE7DE]">
        <div className="mx-auto flex max-w-[78rem] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-[#0E0E0E] text-[10px] font-bold tracking-[0.12em] text-[#F4F1EA]">
              PF
            </span>
            <span className="text-[13px] font-medium text-[#0E0E0E]/6">Pharma Flow</span>
          </div>
          <div className="flex flex-wrap gap-6 text-[13px] text-[#0E0E0E]/5">
            <Link to="/login" className="hover:text-[#0E0E0E]">
              Sign in
            </Link>
            <a href="#safety" className="hover:text-[#0E0E0E]">
              Safety
            </a>
            <a href="#pricing" className="hover:text-[#0E0E0E]">
              Pricing
            </a>
          </div>
          <p className="text-[12px] text-[#0E0E0E]/35">© {new Date().getFullYear()} Pharma Flow</p>
        </div>
      </footer>
    </div>
  );
}
