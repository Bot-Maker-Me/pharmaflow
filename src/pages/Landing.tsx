import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Editorial / Japanese-minimal marketing page.
 * Palette (colour theory + references):
 *   Paper   #F6F4EF  — warm off-white (ma / negative space)
 *   Ink     #1C1C1C  — near-black for type
 *   Charcoal #2A2A2A
 *   Silver  #C8C4BC  — hairlines
 *   Forest  #1F4A4D  — primary accent (trust, clinical)
 *   Clay    #A63737  — rare emphasis only
 * Composition: ~1.618 vertical rhythm, asymmetric hero, restrained motion.
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
    title: "Receive the fax",
    body: "Upload a multi-page PDF or photo. Cover sheets are detected and split without staff intervention.",
  },
  {
    n: "02",
    title: "Extract structured fields",
    body: "Patient, prescriber, DIN, quantity, and SIG are read into a review form in a few seconds.",
  },
  {
    n: "03",
    title: "Verify once",
    body: "Side-by-side document and data. Confidence cues and Health Canada DIN checks before anything leaves the desk.",
  },
  {
    n: "04",
    title: "Push into Kroll",
    body: "A local Windows helper types into Kroll, Propel Rx, or WinRx the same way a technician would — F3, F5, F7.",
  },
];

const principles = [
  {
    title: "Less typing. Same clinical control.",
    body: "Pharma Flow never runs DUR, allergy, or interaction checks. Those stay inside your pharmacy system.",
  },
  {
    title: "One store. One tenancy.",
    body: "Each pharmacy is isolated. Queues, learnings, and agent data do not mix — even for the same DIN.",
  },
  {
    title: "Canada-first infrastructure.",
    body: "Designed for independent and banner stores. Data region options include Canada Central.",
  },
];

const pricingLines = [
  "Unlimited intake on the pilot workstation",
  "Extraction + DIN verification",
  "Kroll · Propel Rx · WinRx profiles",
  "Local Windows agent",
  "14-day pilot, no card required",
];

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
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
    <div className="min-h-screen bg-[#F6F4EF] text-[#1C1C1C] antialiased selection:bg-[#1F4A4D]/15">
      {/* Thin progress — charcoal, not rainbow */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-px bg-[#1C1C1C]/10"
      />

      {/* Nav */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
          scrolled
            ? "border-b border-[#1C1C1C]/08 bg-[#F6F4EF]/92 backdrop-blur-md"
            : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-[4.25rem] max-w-[72rem] items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-[#1C1C1C] text-[11px] font-semibold tracking-[0.12em] text-[#F6F4EF]">
              PF
            </span>
            <span className="text-[15px] font-medium tracking-[-0.01em]">Pharma Flow</span>
          </Link>

          <nav className="hidden items-center gap-9 text-[13px] text-[#1C1C1C]/70 md:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="transition-colors hover:text-[#1C1C1C]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="hidden text-[13px] text-[#1C1C1C]/70 transition hover:text-[#1C1C1C] sm:inline"
            >
              Sign in
            </Link>
            <Link
              to="/login"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[#1C1C1C] px-5 text-[13px] font-medium text-[#F6F4EF] transition hover:bg-[#2A2A2A]"
            >
              Start pilot
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero — golden-ish split: type dominant left, product frame right on lg */}
      <section className="relative pt-[7.5rem] pb-16 sm:pt-[9rem] sm:pb-24">
        <div className="mx-auto grid max-w-[72rem] items-end gap-12 px-5 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16">
          <div className="max-w-xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#1F4A4D]">
              Independent Canadian pharmacies
            </p>
            <h1 className="mt-5 text-[2.65rem] font-semibold leading-[1.05] tracking-[-0.035em] text-[#1C1C1C] sm:text-[3.5rem] lg:text-[4rem]">
              Stop retyping
              <br />
              the fax.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[1.05rem] leading-relaxed text-[#1C1C1C]/65 sm:text-[1.125rem]">
              Pharma Flow reads prescriptions into structured fields, lets your team verify
              once, then enters them into Kroll — so technicians keep their shift for patients,
              not keyboards.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/login"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-[#1F4A4D] px-7 text-[14px] font-medium text-[#F6F4EF] transition hover:bg-[#183741]"
              >
                Start 14-day pilot
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex h-12 items-center rounded-full border border-[#1C1C1C]/15 bg-transparent px-6 text-[14px] font-medium text-[#1C1C1C] transition hover:border-[#1C1C1C]/35"
              >
                How it works
              </a>
            </div>
            <p className="mt-5 text-[12px] tracking-wide text-[#1C1C1C]/45">
              No card · One workstation · Delete anytime
            </p>
          </div>

          {/* Product frame — quiet, not neon */}
          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-[#1C1C1C]/10 bg-white shadow-[0_24px_80px_-32px_rgba(28,28,28,0.35)]">
              <div className="flex items-center gap-2 border-b border-[#1C1C1C]/08 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[#C8C4BC]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#C8C4BC]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#C8C4BC]" />
                <span className="ml-2 text-[11px] text-[#1C1C1C]/40">Verification</span>
              </div>
              <div className="grid gap-0 sm:grid-cols-2">
                <div className="border-b border-[#1C1C1C]/06 bg-[#F0EEE8] p-5 sm:border-b-0 sm:border-r">
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#1C1C1C]/40">
                    Document
                  </p>
                  <div className="mt-4 space-y-2.5">
                    {[88, 72, 64, 80, 56, 70].map((w, i) => (
                      <div
                        key={i}
                        className="h-2.5 rounded-sm bg-[#1C1C1C]/08"
                        style={{ width: `${w}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="p-5">
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#1C1C1C]/40">
                    Fields
                  </p>
                  <dl className="mt-4 space-y-3 text-[13px]">
                    {[
                      ["Patient", "Eleanor Whitfield"],
                      ["DOB", "1957-02-03"],
                      ["Drug", "Apo-Metformin 500 mg"],
                      ["DIN", "00226514"],
                      ["Qty / Refills", "60 · 3"],
                      ["SIG", "1 tab PO BID"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between gap-3 border-b border-[#1C1C1C]/06 pb-2 last:border-0">
                        <dt className="text-[#1C1C1C]/45">{k}</dt>
                        <dd className="text-right font-medium text-[#1C1C1C]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-5 flex h-10 items-center justify-center rounded-full bg-[#1F4A4D] text-[12px] font-medium text-[#F6F4EF]">
                    Ready for Kroll
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-4 text-center text-[11px] text-[#1C1C1C]/40">
              Illustrative layout — not live patient data
            </p>
          </div>
        </div>
      </section>

      {/* Quiet metrics strip */}
      <section className="border-y border-[#1C1C1C]/08 bg-[#EFECE6]">
        <div className="mx-auto grid max-w-[72rem] grid-cols-2 gap-8 px-5 py-12 sm:grid-cols-4 sm:px-8">
          {[
            { v: "6–8 h", l: "Typing saved / tech / day" },
            { v: "2–3 s", l: "Typical extraction" },
            { v: "1 store", l: "Isolated tenancy" },
            { v: "$199", l: "CAD / store / month" },
          ].map((s) => (
            <div key={s.l}>
              <p className="text-2xl font-semibold tracking-tight text-[#1C1C1C] sm:text-3xl">{s.v}</p>
              <p className="mt-1 text-[12px] text-[#1C1C1C]/5">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Problem — sparse editorial */}
      <section id="product" className="scroll-mt-24 py-24 sm:py-32">
        <div className="mx-auto max-w-[72rem] px-5 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#1C1C1C]/4">
              The workday
            </p>
            <h2 className="mt-4 text-[2rem] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[2.75rem]">
              Most of the shift is still
              <span className="text-[#1C1C1C]/4"> retyping what was already written.</span>
            </h2>
            <p className="mt-6 text-[1.05rem] leading-relaxed text-[#1C1C1C]/6">
              Faxes arrive. Someone opens Kroll. Patient. Doctor. DIN. Quantity. SIG.
              Again. Pharma Flow shortens that loop without replacing clinical judgement.
            </p>
          </div>

          <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-[#1C1C1C]/1 bg-[#1C1C1C]/1 sm:grid-cols-3">
            {[
              {
                t: "Hours on intake",
                b: "Technicians lose half a day to the same fields on every script.",
              },
              {
                t: "Noise on the page",
                b: "Handwriting, fax compression, and cover sheets slow everyone down.",
              },
              {
                t: "Typing risk",
                b: "Wrong DIN or patient ID is a safety issue, not a software quirk.",
              },
            ].map((card) => (
              <div key={card.t} className="bg-[#F6F4EF] p-8 sm:p-10">
                <h3 className="text-[1.05rem] font-semibold tracking-tight">{card.t}</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-[#1C1C1C]/55">{card.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How */}
      <section id="how" className="scroll-mt-24 border-t border-[#1C1C1C]/08 bg-[#EFECE6] py-24 sm:py-32">
        <div className="mx-auto max-w-[72rem] px-5 sm:px-8">
          <div className="max-w-xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#1F4A4D]">
              Process
            </p>
            <h2 className="mt-4 text-[2rem] font-semibold tracking-[-0.03em] sm:text-[2.5rem]">
              Four steps. One verification.
            </h2>
          </div>

          <ol className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <li key={step.n} className="relative">
                <span className="font-mono text-[12px] text-[#1C1C1C]/35">{step.n}</span>
                <h3 className="mt-3 text-[1.05rem] font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[#1C1C1C]/55">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Safety / principles */}
      <section id="safety" className="scroll-mt-24 py-24 sm:py-32">
        <div className="mx-auto max-w-[72rem] px-5 sm:px-8">
          <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#1C1C1C]/4">
                Guardrails
              </p>
              <h2 className="mt-4 text-[2rem] font-semibold tracking-[-0.03em] sm:text-[2.5rem]">
                Built to stay out of clinical decisioning.
              </h2>
            </div>
            <div className="space-y-10">
              {principles.map((p) => (
                <div key={p.title} className="border-t border-[#1C1C1C]/1 pt-8 first:border-t-0 first:pt-0">
                  <h3 className="text-[1.1rem] font-semibold">{p.title}</h3>
                  <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-[#1C1C1C]/55">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-24 border-t border-[#1C1C1C]/08 bg-[#1C1C1C] py-24 text-[#F6F4EF] sm:py-32">
        <div className="mx-auto grid max-w-[72rem] gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_0.85fr] lg:items-center">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#F6F4EF]/45">
              Simple pricing
            </p>
            <h2 className="mt-4 text-[2.25rem] font-semibold tracking-[-0.03em] sm:text-[3rem]">
              $199
              <span className="text-[1.1rem] font-normal text-[#F6F4EF]/45"> CAD / store / month</span>
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#F6F4EF]/55">
              One transparent rate for independent stores. Pilot first — keep it only if the hours come back.
            </p>
            <Link
              to="/login"
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-[#F6F4EF] px-7 text-[14px] font-medium text-[#1C1C1C] transition hover:bg-white"
            >
              Start free pilot
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <ul className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8">
            {pricingLines.map((line) => (
              <li key={line} className="flex items-start gap-3 text-[14px] text-[#F6F4EF]/8">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#6D8164]" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1C1C1C]/08 bg-[#F6F4EF]">
        <div className="mx-auto flex max-w-[72rem] flex-col gap-6 px-5 py-12 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-[#1C1C1C] text-[10px] font-semibold tracking-[0.12em] text-[#F6F4EF]">
              PF
            </span>
            <span className="text-[13px] text-[#1C1C1C]/55">Pharma Flow</span>
          </div>
          <div className="flex flex-wrap gap-6 text-[13px] text-[#1C1C1C]/5">
            <Link to="/login" className="hover:text-[#1C1C1C]">
              Sign in
            </Link>
            <a href="#safety" className="hover:text-[#1C1C1C]">
              Safety
            </a>
            <a href="#pricing" className="hover:text-[#1C1C1C]">
              Pricing
            </a>
          </div>
          <p className="text-[12px] text-[#1C1C1C]/35">© {new Date().getFullYear()} Pharma Flow</p>
        </div>
      </footer>
    </div>
  );
}
