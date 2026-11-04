import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Clock, FileWarning, Keyboard } from "lucide-react";

import { AnimatedNumber } from "@/components/landing/AnimatedNumber";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { Marquee } from "@/components/landing/Marquee";
import { Reveal } from "@/components/landing/Reveal";
import { RotatingWord } from "@/components/landing/RotatingWord";
import { cn } from "@/lib/utils";

/**
 * Dynamic editorial landing.
 * Palette (Japanese nature + clinical):
 *   Deep teal #18353B · Forest #1A3D40 · Sage #6D8164
 *   Clay #C45C26 · Paper #F3EFE6 · Ink #0C0C0C
 * Motion: scroll reveal, rotating words, live demo loop, marquee, counters, cursor glow.
 */

const nav = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#safety", label: "Safety" },
  { href: "#pricing", label: "Pricing" },
];

const heroWords = ["faxes", "prescriptions", "handwriting", "DINs", "refills"];

const worksWith = [
  "Kroll",
  "Propel Rx",
  "WinRx",
  "Health Canada DPD",
  "Local Windows agent",
  "Supabase · Canada Central",
  "F3 / F5 / F7 keystrokes",
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

  const onHeroMove = (e: MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <div className="min-h-screen overflow-x-clip bg-[#F3EFE6] text-[#0C0C0C] antialiased selection:bg-[#C45C26]/25">
      {/* Progress */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-gradient-to-r from-[#18353B] via-[#C45C26] to-[#6D8164]"
        style={{ transform: "scaleX(var(--scroll, 0))" }}
      />

      {/* Nav */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled
            ? "border-b border-[#0C0C0C]/08 bg-[#F3EFE6]/92 backdrop-blur-xl"
            : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-[78rem] items-center justify-between px-5 sm:px-8">
          <Link to="/" className="group flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[5px] bg-[#18353B] text-[11px] font-bold tracking-[0.14em] text-[#F3EFE6] transition group-hover:scale-105">
              PF
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Pharma Flow</span>
          </Link>

          <nav className="hidden items-center gap-10 text-[13px] font-medium text-[#0C0C0C]/6 md:flex">
            {nav.map((item) => (
              <a key={item.href} href={item.href} className="transition hover:text-[#0C0C0C]">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="hidden text-[13px] font-medium text-[#0C0C0C]/6 transition hover:text-[#0C0C0C] sm:inline"
            >
              Sign in
            </Link>
            <Link
              to="/login"
              className="group inline-flex h-10 items-center gap-2 rounded-full bg-[#18353B] px-5 text-[13px] font-semibold text-[#F3EFE6] transition hover:bg-[#1A3D40]"
            >
              Start pilot
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section
        onMouseMove={onHeroMove}
        className="relative overflow-hidden pt-28 pb-10 sm:pt-36 sm:pb-16"
      >
        {/* Cursor + ambient orbs */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0 opacity-70"
            style={{
              background:
                "radial-gradient(520px circle at var(--mx, 50%) var(--my, 28%), rgba(196,92,38,0.12), transparent 55%)",
            }}
          />
          <div className="absolute -top-32 left-1/4 h-[420px] w-[420px] animate-float-slow rounded-full bg-[#18353B]/12 blur-[100px] motion-reduce:animate-none" />
          <div
            className="absolute top-40 right-0 h-72 w-72 animate-float-slow rounded-full bg-[#C45C26]/10 blur-[90px] motion-reduce:animate-none"
            style={{ animationDelay: "-4s" }}
          />
          <div
            className="absolute bottom-10 left-10 h-56 w-56 animate-float-slow rounded-full bg-[#6D8164]/15 blur-[80px] motion-reduce:animate-none"
            style={{ animationDelay: "-8s" }}
          />
          {/* Decorative grid dots */}
          <div
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage: "radial-gradient(#0C0C0C22 1px, transparent 1px)",
              backgroundSize: "28px 28px",
              maskImage: "linear-gradient(to bottom, black 0%, transparent 70%)",
            }}
          />
        </div>

        <div className="relative mx-auto max-w-[78rem] px-5 sm:px-8">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#18353B]/20 bg-[#18353B]/08 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#18353B]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#6D8164] opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#6D8164]" />
              </span>
              Canadian independents
            </div>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="mt-7 max-w-[16ch] text-[3.1rem] font-bold leading-[0.98] tracking-[-0.04em] text-[#0C0C0C] sm:text-[4.5rem] lg:text-[5.75rem]">
              Stop typing{" "}
              <RotatingWord words={heroWords} className="text-[#C45C26]" />.
              <span className="mt-1 block text-[#18353B]">Let the desk move faster.</span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="mt-7 max-w-xl text-[1.1rem] leading-relaxed text-[#0C0C0C]/6 sm:text-[1.2rem]">
              Pharma Flow reads faxed prescriptions into structured fields, staff verify once, then
              a local agent enters them into Kroll — reclaiming 6–8 hours of typing every day.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/login"
                className="group inline-flex h-12 items-center gap-2 rounded-full bg-[#C45C26] px-8 text-[14px] font-semibold text-white shadow-lg shadow-[#C45C26]/25 transition hover:-translate-y-0.5 hover:bg-[#A84C1F] hover:shadow-xl"
              >
                Start 14-day pilot
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href="#how"
                className="inline-flex h-12 items-center rounded-full border border-[#0C0C0C]/18 bg-white/50 px-6 text-[14px] font-semibold backdrop-blur transition hover:border-[#0C0C0C]/4 hover:bg-white"
              >
                Watch the flow
              </a>
            </div>
            <p className="mt-4 text-[12px] tracking-wide text-[#0C0C0C]/4">
              No card · One workstation · Delete anytime
            </p>
          </Reveal>

          <Reveal delay={320} variant="scale">
            <div className="mt-14 sm:mt-16">
              <HeroDemo />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Marquee */}
      <section className="border-y border-[#0C0C0C]/08 bg-[#18353B] py-5">
        <Marquee items={worksWith} />
      </section>

      {/* Metrics */}
      <section className="border-b border-[#0C0C0C]/08 bg-[#0C0C0C] text-[#F3EFE6]">
        <div className="mx-auto grid max-w-[78rem] grid-cols-2 gap-8 px-5 py-14 sm:grid-cols-4 sm:px-8 sm:py-16">
          {[
            { to: 8, prefix: "6–", suffix: "h", label: "Saved per tech / day" },
            { to: 3, prefix: "2–", suffix: "s", label: "Extraction time" },
            { to: 100, prefix: "", suffix: "%", label: "Store isolation" },
            { to: 199, prefix: "$", suffix: "", label: "CAD / store / month" },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 100}>
              <p className="text-3xl font-bold tracking-tight sm:text-4xl">
                <AnimatedNumber to={s.to} prefix={s.prefix} suffix={s.suffix} />
              </p>
              <p className="mt-2 text-[13px] text-white/45">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Problem */}
      <section id="product" className="scroll-mt-24 py-24 sm:py-32">
        <div className="mx-auto max-w-[78rem] px-5 sm:px-8">
          <Reveal>
            <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#C45C26]">
              The bottleneck
            </p>
            <h2 className="mt-5 max-w-[15ch] text-[2.4rem] font-bold leading-[1.05] tracking-[-0.035em] sm:text-[3.4rem]">
              Half the shift is still retyping the fax.
            </h2>
          </Reveal>

          <div className="mt-14 grid gap-5 sm:grid-cols-3">
            {[
              {
                icon: Clock,
                t: "Hours lost",
                b: "Technicians burn most of the day on the same fields for every script.",
              },
              {
                icon: FileWarning,
                t: "Noisy pages",
                b: "Handwriting, fax compression, and cover sheets force constant re-work.",
              },
              {
                icon: Keyboard,
                t: "Typing risk",
                b: "Wrong DIN or patient ID is a safety issue — not a software quirk.",
              },
            ].map((card, i) => (
              <Reveal key={card.t} delay={i * 120}>
                <div
                  className={cn(
                    "group h-full rounded-2xl p-8 transition duration-300 hover:-translate-y-1 sm:p-9",
                    i === 1
                      ? "bg-[#18353B] text-[#F3EFE6] shadow-xl shadow-[#18353B]/25"
                      : "bg-white ring-1 ring-[#0C0C0C]/08 hover:shadow-lg",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-xl transition group-hover:scale-110",
                      i === 1 ? "bg-white/10 text-[#E8A882]" : "bg-[#18353B]/08 text-[#18353B]",
                    )}
                  >
                    <card.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-[1.2rem] font-bold tracking-tight">{card.t}</h3>
                  <p
                    className={cn(
                      "mt-3 text-[14px] leading-relaxed",
                      i === 1 ? "text-white/55" : "text-[#0C0C0C]/55",
                    )}
                  >
                    {card.b}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How */}
      <section id="how" className="scroll-mt-24 bg-[#E8E3D8] py-24 sm:py-32">
        <div className="mx-auto max-w-[78rem] px-5 sm:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <Reveal>
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#C45C26]">
                Process
              </p>
              <h2 className="mt-4 text-[2.4rem] font-bold tracking-[-0.035em] sm:text-[3.2rem]">
                Fax in.
                <br />
                Kroll filled.
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <p className="max-w-sm text-[15px] leading-relaxed text-[#0C0C0C]/55">
                Four steps. One human check. No new workflow — just less keyboard time.
              </p>
            </Reveal>
          </div>

          <ol className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <Reveal key={step.n} delay={i * 100} as="li">
                <div className="group h-full rounded-2xl bg-[#F3EFE6] p-7 ring-1 ring-[#0C0C0C]/06 transition hover:-translate-y-1 hover:shadow-md">
                  <span className="text-[2.25rem] font-bold tracking-tight text-[#C45C26] transition group-hover:scale-105">
                    {step.n}
                  </span>
                  <h3 className="mt-4 text-[1.1rem] font-bold tracking-tight">{step.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#0C0C0C]/55">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* Safety */}
      <section id="safety" className="scroll-mt-24 py-24 sm:py-32">
        <div className="mx-auto max-w-[78rem] px-5 sm:px-8">
          <div className="grid gap-16 lg:grid-cols-[1fr_1.15fr] lg:gap-24">
            <Reveal>
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#C45C26]">
                Guardrails
              </p>
              <h2 className="mt-4 text-[2.2rem] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[2.7rem]">
                Outside clinical decisioning. By design.
              </h2>
            </Reveal>
            <div className="space-y-0">
              {principles.map((p, i) => (
                <Reveal key={p.title} delay={i * 100}>
                  <div
                    className={cn(
                      "border-t border-[#0C0C0C]/12 py-8",
                      i === principles.length - 1 && "border-b",
                    )}
                  >
                    <h3 className="text-[1.15rem] font-bold">{p.title}</h3>
                    <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-[#0C0C0C]/55">{p.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-24 relative overflow-hidden bg-[#0C0C0C] py-24 text-[#F3EFE6] sm:py-32">
        <div className="pointer-events-none absolute -right-20 top-0 h-80 w-80 rounded-full bg-[#C45C26]/15 blur-[100px]" />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-64 w-64 rounded-full bg-[#18353B]/40 blur-[80px]" />

        <div className="relative mx-auto max-w-[78rem] px-5 sm:px-8">
          <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <Reveal>
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#C45C26]">
                Pricing
              </p>
              <h2 className="mt-4 text-[3.5rem] font-bold tracking-[-0.04em] sm:text-[5rem]">
                <AnimatedNumber to={199} prefix="$" />
              </h2>
              <p className="mt-1 text-[1.1rem] text-white/45">CAD per store / month</p>
              <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/55">
                One rate. Pilot first. Keep it only if the hours come back to the dispensary floor.
              </p>
              <Link
                to="/login"
                className="mt-10 inline-flex h-12 items-center gap-2 rounded-full bg-[#C45C26] px-8 text-[14px] font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#A84C1F]"
              >
                Start free pilot
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
            <Reveal delay={120} variant="left">
              <ul className="space-y-1 rounded-2xl border border-white/10 bg-white/[0.03] p-2 backdrop-blur">
                {pricingLines.map((line) => (
                  <li
                    key={line}
                    className="flex items-center gap-3 rounded-xl px-5 py-4 text-[14px] text-white/80 transition hover:bg-white/[0.04]"
                  >
                    <Check className="h-4 w-4 shrink-0 text-[#C45C26]" />
                    {line}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-[#0C0C0C]/08 bg-[#F3EFE6] py-20 sm:py-24">
        <div className="mx-auto max-w-[78rem] px-5 text-center sm:px-8">
          <Reveal>
            <h2 className="text-[2.2rem] font-bold tracking-[-0.03em] sm:text-[3rem]">
              Give the keyboard back to the pharmacy.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[15px] text-[#0C0C0C]/55">
              14 days on one workstation. No card. Delete anytime.
            </p>
            <Link
              to="/login"
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-[#18353B] px-8 text-[14px] font-semibold text-[#F3EFE6] transition hover:-translate-y-0.5 hover:bg-[#1A3D40]"
            >
              Start the pilot
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-[#0C0C0C]/08 bg-[#E8E3D8]">
        <div className="mx-auto flex max-w-[78rem] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-[#18353B] text-[10px] font-bold tracking-[0.12em] text-[#F3EFE6]">
              PF
            </span>
            <span className="text-[13px] font-medium text-[#0C0C0C]/55">Pharma Flow</span>
          </div>
          <div className="flex flex-wrap gap-6 text-[13px] text-[#0C0C0C]/45">
            <Link to="/login" className="hover:text-[#0C0C0C]">
              Sign in
            </Link>
            <a href="#safety" className="hover:text-[#0C0C0C]">
              Safety
            </a>
            <a href="#pricing" className="hover:text-[#0C0C0C]">
              Pricing
            </a>
          </div>
          <p className="text-[12px] text-[#0C0C0C]/35">© {new Date().getFullYear()} Pharma Flow</p>
        </div>
      </footer>
    </div>
  );
}
