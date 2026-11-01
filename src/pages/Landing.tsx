import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock,
  FileText,
  Keyboard,
  Pill,
  Play,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

import { AnimatedNumber } from "@/components/landing/AnimatedNumber";
import { GrowBar } from "@/components/landing/GrowBar";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { Marquee } from "@/components/landing/Marquee";
import { Reveal } from "@/components/landing/Reveal";
import { RotatingWord } from "@/components/landing/RotatingWord";
import { SpotlightCard } from "@/components/landing/SpotlightCard";
import { Button } from "@/components/ui/button";
import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useScrollProgress } from "@/hooks/use-scroll-progress";
import { cn } from "@/lib/utils";

const navLinks = [
  { id: "how", label: "How it works" },
  { id: "benefits", label: "Benefits" },
  { id: "safety", label: "Safety" },
  { id: "pricing", label: "Pricing" },
];

const sectionIds = navLinks.map((l) => l.id);

const heroWords = ["prescriptions", "faxes", "handwriting", "refills", "DINs"];

const worksWith = [
  "Kroll",
  "Propel Rx",
  "WinRx",
  "Health Canada DPD",
  "Claude Vision",
  "GPT-4o",
  "Supabase · Canada Central",
  "F3 / F5 / F7 keystrokes",
];

const stats = [
  { prefix: "6–", to: 8, suffix: " hrs", label: "Saved per day per tech" },
  { prefix: "2–", to: 3, suffix: " s", label: "AI extraction time" },
  { prefix: "", to: 90, suffix: "%+", label: "Gross margin" },
  { prefix: "$", to: 199, suffix: "", label: "CAD / store / month" },
];

const steps = [
  {
    icon: FileText,
    title: "Drop the fax",
    description:
      "Upload multi-page PDF or photo. Cover pages are detected and split automatically.",
  },
  {
    icon: Sparkles,
    title: "Vision AI extracts",
    description:
      "Claude / GPT-4o turns handwritten or printed prescriptions into structured JSON in seconds.",
  },
  {
    icon: BadgeCheck,
    title: "Verify & confirm",
    description:
      "Side-by-side review with green / yellow / red confidence. DIN checked against Health Canada DPD.",
  },
  {
    icon: Keyboard,
    title: "One-click push",
    description:
      "Local tray helper injects keystrokes into Kroll, Propel Rx or WinRx — no API required.",
  },
];

const benefits = [
  {
    title: "Eliminate the bottleneck",
    description:
      "Technicians stop typing the same patient, doctor and DIN fields all day. Throughput goes up immediately.",
  },
  {
    title: "Reduce typing errors",
    description:
      "AI + human verification catches illegible handwriting and wrong DINs before they reach the PMS.",
  },
  {
    title: "Keep clinical safety intact",
    description:
      "Pharma Flow never touches DUR, allergy or interaction engines. Kroll still does the clinical work.",
  },
  {
    title: "Works with legacy systems",
    description:
      "No public API needed. The desktop helper speaks the same F3 / F5 / F7 language your staff already use.",
  },
];

const problems = [
  {
    icon: Clock,
    title: "6–8 hours lost daily",
    body: "Manual transcription of patient, prescriber, DIN, quantity and SIG for every script.",
  },
  {
    icon: FileText,
    title: "Handwriting & fax noise",
    body: "Illegible scripts and poor-quality faxes create constant re-work and callbacks.",
  },
  {
    icon: ShieldCheck,
    title: "Error risk",
    body: "Typing mistakes on DINs or patient IDs create safety and compliance exposure.",
  },
];

const safety = [
  {
    title: "No clinical engine",
    body: "We never run DUR, allergy checks or interaction alerts. Those remain 100% inside Kroll / Propel / WinRx.",
  },
  {
    title: "Human verification first",
    body: "Every extraction is reviewed in a side-by-side UI with confidence colour coding before any data is pushed.",
  },
  {
    title: "Canadian data residency",
    body: "Supabase region Canada (Central). Designed for independent and banner stores that need local control.",
  },
];

const pricingFeatures = [
  "Unlimited prescription intake",
  "Vision AI extraction + DIN verification",
  "Kroll, Propel Rx & WinRx profiles",
  "Local desktop helper (Windows)",
  "14-day free pilot included",
  "Email support",
];

export default function Landing() {
  const reduced = useReducedMotion();
  const { progress, active } = useScrollProgress(sectionIds);
  const [scrolled, setScrolled] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [stepsHover, setStepsHover] = useState(false);
  const { ref: stepsRef, inView: stepsInView } = useInView<HTMLDivElement>(0.3);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Smooth anchor scrolling, scoped to this page only.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("scroll-smooth", "motion-reduce:scroll-auto");
    return () => root.classList.remove("scroll-smooth", "motion-reduce:scroll-auto");
  }, []);

  // Walk through the four steps on a loop until the visitor takes over.
  useEffect(() => {
    if (!stepsInView || stepsHover || reduced) return;
    const id = window.setInterval(() => setActiveStep((s) => (s + 1) % steps.length), 2600);
    return () => window.clearInterval(id);
  }, [stepsInView, stepsHover, reduced]);

  const onHeroMove = (e: MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <div className="min-h-screen overflow-x-clip bg-slate-950 text-slate-100">
      {/* Scroll progress */}
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-400"
        style={{ transform: `scaleX(${progress})` }}
      />

      {/* ── Nav ── */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled
            ? "border-b border-white/10 bg-slate-950/80 backdrop-blur-xl"
            : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 ring-1 ring-indigo-400/40 transition duration-300 group-hover:rotate-12 group-hover:bg-indigo-500/30">
              <Pill className="h-5 w-5 text-indigo-300" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-white">
              Pharma Flow
            </span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                className={cn(
                  "group relative py-1 transition hover:text-white",
                  active === link.id && "text-white",
                )}
              >
                {link.label}
                <span
                  className={cn(
                    "absolute -bottom-0.5 left-0 h-px w-full origin-left bg-indigo-400 transition-transform duration-300 group-hover:scale-x-100",
                    active === link.id ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Button
              asChild
              variant="ghost"
              className="hidden text-slate-300 hover:bg-white/5 hover:text-white sm:inline-flex"
            >
              <Link to="/app">Open app</Link>
            </Button>
            <Button
              asChild
              className="group bg-indigo-500 text-white transition hover:-translate-y-0.5 hover:bg-indigo-400 hover:shadow-lg hover:shadow-indigo-500/30"
            >
              <Link to="/app">
                Start free pilot
                <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section
        onMouseMove={onHeroMove}
        className="relative overflow-hidden pt-28 pb-20 sm:pt-36 sm:pb-28"
      >
        {/* Drifting background glows */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 animate-float-slow rounded-full bg-indigo-600/20 blur-[120px] motion-reduce:animate-none" />
          <div
            className="absolute top-40 right-0 h-80 w-80 animate-float-slow rounded-full bg-violet-500/15 blur-[100px] motion-reduce:animate-none"
            style={{ animationDelay: "-5s" }}
          />
          <div
            className="absolute bottom-0 left-10 h-60 w-60 animate-float-slow rounded-full bg-cyan-500/15 blur-[80px] motion-reduce:animate-none"
            style={{ animationDelay: "-9s" }}
          />
          {/* Cursor-following light */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(520px circle at var(--mx, 50%) var(--my, 30%), rgba(129,140,248,0.16), transparent 60%)",
            }}
          />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-medium text-indigo-200">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <Zap className="h-3.5 w-3.5" />
                Built for Canadian independent pharmacies
              </div>
            </Reveal>

            <Reveal delay={100}>
              <h1 className="text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Stop typing{" "}
                <RotatingWord words={heroWords} className="text-indigo-200" />.
                <span className="mt-1 block animate-gradient-pan bg-gradient-to-r from-indigo-300 via-violet-300 to-cyan-300 bg-[length:200%_200%] bg-clip-text text-transparent motion-reduce:animate-none">
                  Let AI do the data entry.
                </span>
              </h1>
            </Reveal>

            <Reveal delay={220}>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-slate-300 sm:text-xl">
                Pharma Flow turns faxed and handwritten prescriptions into structured
                data in 2–3 seconds, then pushes them into Kroll, Propel Rx or WinRx
                with one click — so your team stops spending 6–8 hours a day on
                manual intake.
              </p>
            </Reveal>

            <Reveal delay={340}>
              <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="group h-12 bg-indigo-500 px-8 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition duration-300 hover:-translate-y-0.5 hover:bg-indigo-400 hover:shadow-xl hover:shadow-indigo-500/40"
                >
                  <Link to="/app">
                    Start free 14-day pilot
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="group h-12 border-white/20 bg-white/5 px-8 text-base text-white transition duration-300 hover:-translate-y-0.5 hover:bg-white/10"
                >
                  <a href="#how">
                    <Play className="mr-2 h-4 w-4 transition-transform group-hover:scale-125" />
                    See how it works
                  </a>
                </Button>
              </div>

              <p className="mt-5 text-sm text-slate-400">
                No credit card · Zero risk · Delete anytime
              </p>
            </Reveal>
          </div>

          <Reveal delay={450} variant="scale">
            <HeroDemo />
          </Reveal>
        </div>
      </section>

      {/* ── Works-with ticker ── */}
      <section className="border-y border-white/5 bg-slate-900/30 py-5">
        <Marquee items={worksWith} />
      </section>

      {/* ── Stats bar ── */}
      <section className="border-b border-white/5 bg-slate-900/50">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 py-10 sm:grid-cols-4 sm:px-6">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 120} className="text-center">
              <p className="text-2xl font-bold text-white sm:text-3xl">
                <AnimatedNumber to={s.to} prefix={s.prefix} suffix={s.suffix} />
              </p>
              <p className="mt-1 text-sm text-slate-400">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Problem ── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              The daily grind that never ends
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              Pharmacy assistants and technicians spend most of their shift
              re-typing the same information from faxes into 15-year-old Windows
              software. It is slow, error-prone, and exhausting.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-6 sm:grid-cols-3">
            {problems.map((item, i) => (
              <Reveal key={item.title} delay={i * 130}>
                <SpotlightCard className="h-full rounded-2xl border border-white/10 bg-slate-900/60 p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300 transition duration-300 group-hover:scale-110 group-hover:rotate-6 group-hover:bg-indigo-500/25">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
                </SpotlightCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section
        id="how"
        className="scroll-mt-16 border-t border-white/5 bg-slate-900/40 py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              From fax to Kroll in under a minute
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              Four simple steps. No new workflow for your staff — just less typing.
            </p>
          </Reveal>

          <div
            ref={stepsRef}
            onMouseEnter={() => setStepsHover(true)}
            onMouseLeave={() => setStepsHover(false)}
            className="relative mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4"
          >
            {steps.map((step, i) => {
              const isActive = i === activeStep;
              const reached = i <= activeStep;
              return (
                <Reveal key={step.title} delay={i * 150}>
                  <button
                    type="button"
                    onClick={() => setActiveStep(i)}
                    onFocus={() => setActiveStep(i)}
                    className="group relative block w-full text-left outline-none"
                  >
                    {/* Connector to the next step; fills once the walkthrough passes this step */}
                    {i < steps.length - 1 && (
                      <div
                        aria-hidden
                        className="absolute -right-7 left-[3.75rem] top-6 hidden h-px bg-white/10 lg:block"
                      >
                        <div
                          className="h-full bg-gradient-to-r from-indigo-400 to-cyan-300 transition-[width] duration-700 ease-out"
                          style={{ width: i < activeStep ? "100%" : "0%" }}
                        />
                      </div>
                    )}
                    <div
                      className={cn(
                        "relative flex h-12 w-12 items-center justify-center rounded-2xl ring-1 transition-all duration-500 group-hover:scale-110",
                        isActive
                          ? "scale-110 bg-indigo-500 text-white shadow-lg shadow-indigo-500/40 ring-indigo-300/60"
                          : reached
                            ? "bg-indigo-500/25 text-indigo-200 ring-indigo-400/40"
                            : "bg-slate-900 text-indigo-300/70 ring-white/10",
                      )}
                    >
                      <step.icon className="h-5 w-5" />
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute inset-0 animate-pulse-ring rounded-2xl bg-indigo-400/40 motion-reduce:animate-none"
                        />
                      )}
                    </div>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-indigo-300">
                      Step {i + 1}
                    </p>
                    <h3
                      className={cn(
                        "mt-1 text-lg font-semibold transition-colors duration-300",
                        isActive ? "text-white" : "text-slate-300",
                      )}
                    >
                      {step.title}
                    </h3>
                    <p
                      className={cn(
                        "mt-2 text-sm leading-relaxed transition-colors duration-300",
                        isActive ? "text-slate-300" : "text-slate-500",
                      )}
                    >
                      {step.description}
                    </p>
                  </button>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Benefits ── */}
      <section id="benefits" className="scroll-mt-16 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <Reveal>
                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  Built for the reality of Canadian community pharmacy
                </h2>
                <p className="mt-4 text-lg text-slate-300">
                  Legacy PMS systems will not change. Staff muscle memory will not
                  change. Pharma Flow works with both instead of fighting them.
                </p>
              </Reveal>
              <ul className="mt-8 space-y-5">
                {benefits.map((b, i) => (
                  <Reveal key={b.title} as="li" variant="left" delay={i * 120} className="group flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400 transition duration-300 group-hover:scale-125" />
                    <div>
                      <p className="font-medium text-white">{b.title}</p>
                      <p className="mt-0.5 text-sm text-slate-400">{b.description}</p>
                    </div>
                  </Reveal>
                ))}
              </ul>
            </div>

            <Reveal variant="right" delay={150}>
              <SpotlightCard className="rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/10 via-slate-900 to-slate-900 p-8">
                <p className="text-sm font-medium uppercase tracking-wider text-indigo-300">
                  Typical store impact
                </p>
                <div className="mt-6 space-y-6">
                  <div>
                    <div className="flex items-end justify-between">
                      <span className="text-slate-300">Time on data entry</span>
                      <span className="text-2xl font-bold text-white">
                        <AnimatedNumber to={70} prefix="−" suffix="%" />
                      </span>
                    </div>
                    <GrowBar percent={30} barClassName="bg-indigo-500" />
                  </div>
                  <div>
                    <div className="flex items-end justify-between">
                      <span className="text-slate-300">Scripts processed / day</span>
                      <span className="text-2xl font-bold text-white">
                        <AnimatedNumber to={40} prefix="+" suffix="%" />
                      </span>
                    </div>
                    <GrowBar percent={70} barClassName="bg-emerald-500" delay={150} />
                  </div>
                  <div>
                    <div className="flex items-end justify-between">
                      <span className="text-slate-300">Transcription errors</span>
                      <span className="inline-block animate-float text-2xl font-bold text-white motion-reduce:animate-none">
                        ↓
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">
                      AI confidence scoring + DIN database match before any keystroke is sent.
                    </p>
                  </div>
                </div>
              </SpotlightCard>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Safety ── */}
      <section
        id="safety"
        className="scroll-mt-16 border-t border-white/5 bg-slate-900/40 py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Clinical safety stays with the PMS
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              Pharma Flow is an intake and data-entry assistant — not a clinical
              decision system.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {safety.map((item, i) => (
              <Reveal key={item.title} delay={i * 130}>
                <SpotlightCard className="h-full rounded-2xl border border-white/10 bg-slate-950/50 p-6">
                  <ShieldCheck className="h-6 w-6 text-indigo-300 transition duration-300 group-hover:scale-125 group-hover:text-emerald-300" />
                  <h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
                </SpotlightCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="scroll-mt-16 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Simple pricing for independent stores
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              One transparent price. No per-script fees. Cancel anytime.
            </p>
          </Reveal>

          <Reveal variant="scale" delay={120} className="mx-auto mt-12 max-w-md">
            <div className="animate-gradient-pan rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-500 bg-[length:200%_200%] p-px shadow-xl shadow-indigo-500/10 transition duration-300 hover:-translate-y-1 hover:shadow-indigo-500/30 motion-reduce:animate-none">
              <div className="rounded-[15px] bg-gradient-to-b from-slate-900 to-slate-950 p-8">
                <p className="text-sm font-medium text-indigo-300">Per pharmacy store</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-5xl font-bold text-white">
                    <AnimatedNumber to={199} prefix="$" />
                  </span>
                  <span className="text-slate-400">CAD / month</span>
                </div>
                <ul className="mt-8 space-y-3 text-sm text-slate-300">
                  {pricingFeatures.map((f, i) => (
                    <Reveal key={f} as="li" variant="left" delay={200 + i * 80} className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      {f}
                    </Reveal>
                  ))}
                </ul>
                <Button
                  asChild
                  className="group mt-8 h-12 w-full bg-indigo-500 text-base font-semibold transition duration-300 hover:bg-indigo-400 hover:shadow-lg hover:shadow-indigo-500/40"
                >
                  <Link to="/app">
                    Start free pilot
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
                <p className="mt-4 text-center text-xs text-slate-500">
                  No credit card required for the pilot
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative overflow-hidden border-t border-white/5 py-20 sm:py-24">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-72 w-[700px] -translate-x-1/2 -translate-y-1/2 animate-float-slow rounded-full bg-indigo-600/15 blur-[100px] motion-reduce:animate-none" />
        </div>
        <Reveal className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Give your team their time back
          </h2>
          <p className="mt-4 text-lg text-slate-300">
            Install on one workstation. Run the 14-day pilot. If it does not save
            at least an hour a day, delete it.
          </p>
          <Button
            asChild
            size="lg"
            className="group mt-8 h-12 bg-indigo-500 px-10 text-base font-semibold shadow-lg shadow-indigo-500/25 transition duration-300 hover:-translate-y-0.5 hover:bg-indigo-400 hover:shadow-xl hover:shadow-indigo-500/40"
          >
            <Link to="/app">
              Open Pharma Flow
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </Reveal>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Pill className="h-4 w-4 text-indigo-300" />
            <span className="text-sm font-medium text-slate-300">Pharma Flow</span>
          </div>
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} Pharma Flow. Built for Canadian community pharmacies.
          </p>
        </div>
      </footer>
    </div>
  );
}
