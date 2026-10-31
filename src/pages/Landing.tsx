import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  FileText,
  Keyboard,
  Pill,
  ShieldCheck,
  Sparkles,
  Zap,
  CheckCircle2,
  Play,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const stats = [
  { value: "6–8 hrs", label: "Saved per day per tech" },
  { value: "2–3 s", label: "AI extraction time" },
  { value: "90%+", label: "Gross margin" },
  { value: "$199", label: "CAD / store / month" },
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

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
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
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 ring-1 ring-indigo-400/40">
              <Pill className="h-5 w-5 text-indigo-300" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-white">
              Pharma Flow
            </span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#how" className="transition hover:text-white">
              How it works
            </a>
            <a href="#benefits" className="transition hover:text-white">
              Benefits
            </a>
            <a href="#safety" className="transition hover:text-white">
              Safety
            </a>
            <a href="#pricing" className="transition hover:text-white">
              Pricing
            </a>
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
              className="bg-indigo-500 text-white hover:bg-indigo-400"
            >
              <Link to="/app">
                Start free pilot
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden pt-28 pb-20 sm:pt-36 sm:pb-28">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
          <div className="absolute top-40 right-0 h-80 w-80 rounded-full bg-violet-500/10 blur-[100px]" />
          <div className="absolute bottom-0 left-10 h-60 w-60 rounded-full bg-cyan-500/10 blur-[80px]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-medium text-indigo-200">
              <Zap className="h-3.5 w-3.5" />
              Built for Canadian independent pharmacies
            </div>

            <h1 className="text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Stop typing prescriptions.{" "}
              <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-cyan-300 bg-clip-text text-transparent">
                Let AI do the data entry.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-slate-300 sm:text-xl">
              Pharma Flow turns faxed and handwritten prescriptions into structured
              data in 2–3 seconds, then pushes them into Kroll, Propel Rx or WinRx
              with one click — so your team stops spending 6–8 hours a day on
              manual intake.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 bg-indigo-500 px-8 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-400"
              >
                <Link to="/app">
                  Start free 14-day pilot
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 border-white/20 bg-white/5 px-8 text-base text-white hover:bg-white/10"
              >
                <a href="#how">
                  <Play className="mr-2 h-4 w-4" />
                  See how it works
                </a>
              </Button>
            </div>

            <p className="mt-5 text-sm text-slate-400">
              No credit card · Zero risk · Delete anytime
            </p>
          </div>

          {/* Floating product preview */}
          <div className="relative mx-auto mt-16 max-w-4xl">
            <div className="absolute -inset-4 rounded-2xl bg-gradient-to-r from-indigo-500/20 via-violet-500/10 to-cyan-500/20 blur-2xl" />
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 shadow-2xl shadow-black/40 backdrop-blur">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                <span className="ml-3 text-xs text-slate-400">
                  Pharma Flow · Intake workspace
                </span>
              </div>
              <div className="grid gap-0 md:grid-cols-5">
                <div className="border-r border-white/5 p-5 md:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Document
                  </p>
                  <div className="mt-3 flex aspect-[3/4] items-center justify-center rounded-lg border border-dashed border-white/10 bg-slate-800/50">
                    <div className="text-center">
                      <FileText className="mx-auto h-10 w-10 text-slate-600" />
                      <p className="mt-2 text-xs text-slate-500">Fax preview</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4 p-5 md:col-span-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                      Extracted fields
                    </p>
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                      96% confidence
                    </span>
                  </div>
                  {[
                    { label: "Patient", value: "Eleanor Whitfield", ok: true },
                    { label: "DOB", value: "1957-02-03", ok: true },
                    { label: "Drug", value: "Apo-Metformin 500 mg", ok: true },
                    { label: "DIN", value: "00226514", ok: true },
                    { label: "Qty / Refills", value: "60 · 3", ok: true },
                    { label: "SIG", value: "1 tab PO BID", ok: true },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5"
                    >
                      <span className="text-xs text-slate-400">{row.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-100">
                          {row.value}
                        </span>
                        {row.ok && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        )}
                      </div>
                    </div>
                  ))}
                  <Button className="mt-2 w-full bg-indigo-500 hover:bg-indigo-400">
                    Push to Kroll
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="border-y border-white/5 bg-slate-900/50">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 py-10 sm:grid-cols-4 sm:px-6">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-2xl font-bold text-white sm:text-3xl">{s.value}</p>
              <p className="mt-1 text-sm text-slate-400">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Problem ── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              The daily grind that never ends
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              Pharmacy assistants and technicians spend most of their shift
              re-typing the same information from faxes into 15-year-old Windows
              software. It is slow, error-prone, and exhausting.
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-3">
            {[
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
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/10 bg-slate-900/60 p-6"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="border-t border-white/5 bg-slate-900/40 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              From fax to Kroll in under a minute
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              Four simple steps. No new workflow for your staff — just less typing.
            </p>
          </div>

          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <div key={step.title} className="relative">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/30">
                  <step.icon className="h-5 w-5" />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-indigo-300">
                  Step {i + 1}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Benefits ── */}
      <section id="benefits" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Built for the reality of Canadian community pharmacy
              </h2>
              <p className="mt-4 text-lg text-slate-300">
                Legacy PMS systems will not change. Staff muscle memory will not
                change. Pharma Flow works with both instead of fighting them.
              </p>
              <ul className="mt-8 space-y-5">
                {benefits.map((b) => (
                  <li key={b.title} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                    <div>
                      <p className="font-medium text-white">{b.title}</p>
                      <p className="mt-0.5 text-sm text-slate-400">{b.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/10 via-slate-900 to-slate-900 p-8">
              <p className="text-sm font-medium uppercase tracking-wider text-indigo-300">
                Typical store impact
              </p>
              <div className="mt-6 space-y-6">
                <div>
                  <div className="flex items-end justify-between">
                    <span className="text-slate-300">Time on data entry</span>
                    <span className="text-2xl font-bold text-white">−70%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full w-[30%] rounded-full bg-indigo-500" />
                  </div>
                </div>
                <div>
                  <div className="flex items-end justify-between">
                    <span className="text-slate-300">Scripts processed / day</span>
                    <span className="text-2xl font-bold text-white">+40%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full w-[70%] rounded-full bg-emerald-500" />
                  </div>
                </div>
                <div>
                  <div className="flex items-end justify-between">
                    <span className="text-slate-300">Transcription errors</span>
                    <span className="text-2xl font-bold text-white">↓</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    AI confidence scoring + DIN database match before any keystroke is sent.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Safety ── */}
      <section id="safety" className="border-t border-white/5 bg-slate-900/40 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Clinical safety stays with the PMS
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              Pharma Flow is an intake and data-entry assistant — not a clinical
              decision system.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {[
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
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/10 bg-slate-950/50 p-6"
              >
                <ShieldCheck className="h-6 w-6 text-indigo-300" />
                <h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Simple pricing for independent stores
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              One transparent price. No per-script fees. Cancel anytime.
            </p>
          </div>

          <div className="mx-auto mt-12 max-w-md">
            <div className="rounded-2xl border border-indigo-400/30 bg-gradient-to-b from-indigo-500/10 to-slate-900 p-8 shadow-xl shadow-indigo-500/10">
              <p className="text-sm font-medium text-indigo-300">Per pharmacy store</p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-5xl font-bold text-white">$199</span>
                <span className="text-slate-400">CAD / month</span>
              </div>
              <ul className="mt-8 space-y-3 text-sm text-slate-300">
                {[
                  "Unlimited prescription intake",
                  "Vision AI extraction + DIN verification",
                  "Kroll, Propel Rx & WinRx profiles",
                  "Local desktop helper (Windows)",
                  "14-day free pilot included",
                  "Email support",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className="mt-8 h-12 w-full bg-indigo-500 text-base font-semibold hover:bg-indigo-400"
              >
                <Link to="/app">
                  Start free pilot
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <p className="mt-4 text-center text-xs text-slate-500">
                No credit card required for the pilot
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="border-t border-white/5 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
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
            className="mt-8 h-12 bg-indigo-500 px-10 text-base font-semibold shadow-lg shadow-indigo-500/25 hover:bg-indigo-400"
          >
            <Link to="/app">
              Open Pharma Flow
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
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
