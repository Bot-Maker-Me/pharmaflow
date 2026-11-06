import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, FileText, Lock, ScanLine, ShieldCheck, Zap } from "lucide-react";

import { AnimatedNumber } from "@/components/landing/AnimatedNumber";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { Marquee } from "@/components/landing/Marquee";
import { Reveal } from "@/components/landing/Reveal";
import { RotatingWord } from "@/components/landing/RotatingWord";
import { cn } from "@/lib/utils";

/**
 * Product landing inspired by Slipstream / Stratum (Impeccable gallery):
 * near-black canvas, acid-lime accent, massive type, product UI as the graphic.
 */

const ACCENT = "#C8F542";

const nav = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#safety", label: "Safety" },
  { href: "#pricing", label: "Pricing" },
];

const heroWords = ["faxes", "scripts", "handwriting", "DINs", "refills"];

const worksWith = [
  "TELUS Kroll",
  "Propel Rx",
  "WinRx",
  "Health Canada DPD",
  "Local Windows agent",
  "Canada-central data",
  "F3 · F5 · F7 keystrokes",
];

const story = [
  {
    step: "01",
    title: "The fax arrives",
    body: "Multi-page PDF or photo. Cover sheets are ignored. The page you need is isolated.",
    icon: FileText,
  },
  {
    step: "02",
    title: "Fields fill themselves",
    body: "Patient, prescriber, DIN, strength, quantity, SIG — structured in a few seconds.",
    icon: ScanLine,
  },
  {
    step: "03",
    title: "Human verifies once",
    body: "Side-by-side with the page image. DIN checked against Health Canada. Staff own the call.",
    icon: ShieldCheck,
  },
  {
    step: "04",
    title: "Kroll is typed for you",
    body: "Local agent plays F3 / F5 / F7 into the open window. Same workflow — almost no keyboard.",
    icon: Zap,
  },
];

const features = [
  {
    title: "Built for the dispensary, not a generic OCR demo",
    body: "Canadian DINs, provincial health cards, Latin SIG → plain English, and Kroll keystroke maps.",
  },
  {
    title: "Learns from your staff",
    body: "When a tech corrects a field, the next extract improves. Shadow mode also learns from what was typed in Kroll.",
  },
  {
    title: "One store. Zero bleed.",
    body: "Row-level isolation. Agent keys, queue, and learnings never cross pharmacies.",
  },
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
    <div className="min-h-screen overflow-x-clip bg-[#050505] text-[#F4F4F5] antialiased selection:bg-[#C8F542]/30">
      {/* ── Nav ── */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-colors duration-200",
          scrolled ? "border-b border-white/10 bg-[#050505]/90 backdrop-blur-md" : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-md text-[11px] font-black tracking-wide text-[#050505]"
              style={{ background: ACCENT }}
            >
              PF
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Pharma Flow</span>
          </Link>

          <nav className="hidden items-center gap-8 text-[13px] text-zinc-400 md:flex">
            {nav.map((item) => (
              <a key={item.href} href={item.href} className="transition hover:text-white">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden text-[13px] text-zinc-400 transition hover:text-white sm:inline">
              Sign in
            </Link>
            <Link
              to="/login"
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13px] font-bold text-[#050505] transition hover:brightness-110"
              style={{ background: ACCENT }}
            >
              Start pilot
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO — Slipstream-style split: type + product ── */}
      <section className="relative overflow-hidden pt-28 pb-10 sm:pt-32 sm:pb-16">
        {/* ambient lime wash */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 right-0 h-[520px] w-[520px] rounded-full opacity-30 blur-[100px]"
          style={{ background: ACCENT }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-[300px] w-[400px] rounded-full opacity-10 blur-[80px]"
          style={{ background: ACCENT }}
        />

        <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid items-end gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
            <div>
              <Reveal>
                <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                  Canadian independent pharmacies
                </p>
              </Reveal>

              <Reveal delay={50}>
                <h1 className="mt-5 text-[2.75rem] font-black leading-[0.95] tracking-[-0.045em] sm:text-[4.25rem] lg:text-[4.75rem]">
                  STOP
                  <br />
                  RETYPING{" "}
                  <span className="block" style={{ color: ACCENT }}>
                    <RotatingWord words={heroWords} className="" />.
                  </span>
                </h1>
              </Reveal>

              <Reveal delay={110}>
                <p className="mt-6 max-w-md text-[1.05rem] leading-relaxed text-zinc-400">
                  Fax in. Verify once. A local agent fills Kroll — without replacing clinical checks.
                </p>
              </Reveal>

              <Reveal delay={160}>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link
                    to="/login"
                    className="group inline-flex h-12 items-center gap-2 rounded-md px-6 text-[14px] font-bold text-[#050505] transition hover:brightness-110"
                    style={{ background: ACCENT }}
                  >
                    Start 14-day pilot
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  <a
                    href="#how"
                    className="inline-flex h-12 items-center rounded-md border border-white/15 px-5 text-[14px] font-medium text-zinc-200 transition hover:border-white/30 hover:bg-white/5"
                  >
                    See how it works
                  </a>
                </div>
                <p className="mt-4 text-[12px] text-zinc-600">No card · One workstation · Cancel anytime</p>
              </Reveal>
            </div>

            {/* Product frame as primary graphic */}
            <Reveal delay={120} variant="scale">
              <div className="relative">
                <div
                  className="absolute -inset-3 rounded-2xl opacity-40 blur-2xl"
                  style={{ background: `radial-gradient(circle at 70% 30%, ${ACCENT}55, transparent 60%)` }}
                />
                <HeroDemo />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Marquee */}
      <section className="border-y border-white/10 bg-[#0A0A0A] py-3.5">
        <Marquee items={worksWith} />
      </section>

      {/* Metrics */}
      <section className="border-b border-white/10">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-5 py-14 sm:grid-cols-4 sm:px-6">
          {[
            { to: 8, prefix: "6–", suffix: "h", label: "Saved per tech / day" },
            { to: 3, prefix: "~", suffix: "s", label: "Typical extract" },
            { to: 100, prefix: "", suffix: "%", label: "Store isolation" },
            { to: 199, prefix: "$", suffix: "", label: "CAD / store / mo" },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 70}>
              <p className="text-3xl font-black tracking-tight sm:text-4xl" style={{ color: i === 0 ? ACCENT : undefined }}>
                <AnimatedNumber to={s.to} prefix={s.prefix} suffix={s.suffix} />
              </p>
              <p className="mt-1.5 text-[13px] text-zinc-500">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Problem */}
      <section id="product" className="scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <Reveal>
            <p className="text-[12px] font-semibold uppercase tracking-[0.22em]" style={{ color: ACCENT }}>
              The problem
            </p>
            <h2 className="mt-3 max-w-[14ch] text-[2.5rem] font-black leading-[1.05] tracking-[-0.04em] sm:text-[3.5rem]">
              Half the shift is still the keyboard.
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-zinc-400">
              Handwritten and faxed scripts pile up. Technicians retype the same fields into legacy Windows software
              while the queue waits.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {[
              { t: "Hours of typing", b: "6–8 hours a day on patient, doctor, drug, qty, and SIG — for every script." },
              { t: "Messy pages", b: "Compression, covers, and handwriting force constant re-work and second looks." },
              { t: "Safety risk", b: "A wrong DIN or patient ID is not a UI bug. It is a clinical incident waiting." },
            ].map((card, i) => (
              <Reveal key={card.t} delay={i * 80}>
                <div className="group h-full rounded-xl border border-white/10 bg-[#0C0C0C] p-6 transition hover:border-[#C8F542]/35">
                  <div className="mb-5 h-1 w-12 rounded-full" style={{ background: ACCENT }} />
                  <h3 className="text-lg font-bold tracking-tight">{card.t}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-zinc-400">{card.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How */}
      <section id="how" className="scroll-mt-20 border-t border-white/10 bg-[#080808] py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <Reveal>
            <p className="text-[12px] font-semibold uppercase tracking-[0.22em]" style={{ color: ACCENT }}>
              How it works
            </p>
            <h2 className="mt-3 text-[2.5rem] font-black tracking-[-0.04em] sm:text-[3.25rem]">Fax in. Kroll filled.</h2>
          </Reveal>

          <div className="mt-14 grid gap-4 sm:grid-cols-2">
            {story.map((s, i) => (
              <Reveal key={s.step} delay={i * 70}>
                <div className="flex gap-5 rounded-xl border border-white/10 bg-[#0C0C0C] p-6 transition hover:border-white/20">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-[#050505]"
                    style={{ background: ACCENT }}
                  >
                    <s.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold tracking-widest text-zinc-600">{s.step}</p>
                    <h3 className="mt-1 text-lg font-bold">{s.title}</h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-zinc-400">{s.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Product graphic — dual panel like Stratum/Slipstream demos */}
      <section className="border-t border-white/10 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <Reveal>
            <p className="text-center text-[12px] font-semibold uppercase tracking-[0.22em]" style={{ color: ACCENT }}>
              Product
            </p>
            <h2 className="mx-auto mt-3 max-w-[18ch] text-center text-[2.25rem] font-black tracking-[-0.04em] sm:text-[3rem]">
              Verification that shows the page, not just the fields.
            </h2>
          </Reveal>

          <Reveal delay={90} variant="scale">
            <div className="relative mx-auto mt-14 max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#0C0C0C] shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                <span className="ml-3 text-xs text-zinc-500">Verification · side by side</span>
                <span
                  className="ml-auto rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#050505]"
                  style={{ background: ACCENT }}
                >
                  Live
                </span>
              </div>
              <div className="grid md:grid-cols-2">
                <div className="border-r border-white/5 bg-[#101010] p-6">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Fax page</p>
                  <div className="relative mt-3 aspect-[3/4] overflow-hidden rounded-lg bg-[#EDE8DF] p-5 shadow-inner">
                    <div className="mb-4 h-2 w-2/5 rounded bg-black/20" />
                    <div className="space-y-3">
                      {["w-4/5", "w-3/5", "w-full", "w-2/3", "w-1/2"].map((w) => (
                        <div key={w} className={cn("h-2.5 rounded bg-black/15", w)} />
                      ))}
                    </div>
                    <div
                      className="mt-8 rounded-md border-2 p-3"
                      style={{ borderColor: `${ACCENT}99`, background: `${ACCENT}22` }}
                    >
                      <div className="h-2 w-1/3 rounded bg-black/20" />
                      <div className="mt-2 h-3 w-2/3 rounded bg-black/25" />
                    </div>
                  </div>
                </div>
                <div className="space-y-3 p-6">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Extracted</p>
                  {[
                    ["Patient", "Audrey Lambert"],
                    ["DOB", "1948-07-31"],
                    ["Drug", "Apo-Metformin 500 mg"],
                    ["DIN", "00226514"],
                    ["SIG", "1 tab PO BID"],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5"
                    >
                      <span className="text-xs text-zinc-500">{k}</span>
                      <span className="text-sm font-semibold">{v}</span>
                    </div>
                  ))}
                  <div className="pt-2">
                    <div
                      className="flex h-11 items-center justify-center rounded-md text-[13px] font-bold text-[#050505]"
                      style={{ background: ACCENT }}
                    >
                      Push to Kroll
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Safety */}
      <section id="safety" className="scroll-mt-20 border-t border-white/10 bg-[#080808] py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <Reveal>
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em]" style={{ color: ACCENT }}>
                Guardrails
              </p>
              <h2 className="mt-3 text-[2.25rem] font-black leading-[1.1] tracking-[-0.04em] sm:text-[2.75rem]">
                Outside clinical decisioning. By design.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-zinc-400">
                Pharma Flow moves intake data. DUR, allergies, and claims stay inside Kroll where they belong.
              </p>
            </Reveal>
            <div className="space-y-3">
              {features.map((f, i) => (
                <Reveal key={f.title} delay={i * 70}>
                  <div className="flex gap-4 rounded-xl border border-white/10 bg-[#0C0C0C] p-5">
                    <Lock className="mt-0.5 h-5 w-5 shrink-0" style={{ color: ACCENT }} />
                    <div>
                      <h3 className="font-bold">{f.title}</h3>
                      <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-400">{f.body}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-t border-white/10 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em]" style={{ color: ACCENT }}>
                Pricing
              </p>
              <p className="mt-4 text-[5rem] font-black tracking-tighter sm:text-[6rem]" style={{ color: ACCENT }}>
                <AnimatedNumber to={199} prefix="$" />
              </p>
              <p className="text-[1.1rem] text-zinc-400">CAD per store / month</p>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-zinc-500">
                One rate. Pilot first. Keep it only if the hours return to the dispensary floor.
              </p>
              <Link
                to="/login"
                className="mt-8 inline-flex h-12 items-center gap-2 rounded-md px-6 text-[14px] font-bold text-[#050505] transition hover:brightness-110"
                style={{ background: ACCENT }}
              >
                Start free pilot
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
            <Reveal delay={90}>
              <ul className="space-y-1 rounded-xl border border-white/10 bg-[#0C0C0C] p-2">
                {[
                  "Unlimited intake on the pilot workstation",
                  "Extraction + DIN verification",
                  "Kroll · Propel Rx · WinRx profiles",
                  "Local Windows agent",
                  "14-day pilot — no card",
                ].map((line) => (
                  <li key={line} className="flex items-center gap-3 rounded-lg px-4 py-3.5 text-[14px] text-zinc-300">
                    <Check className="h-4 w-4 shrink-0" style={{ color: ACCENT }} />
                    {line}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/10 py-24">
        <div className="mx-auto max-w-6xl px-5 text-center sm:px-6">
          <Reveal>
            <h2 className="text-[2.5rem] font-black tracking-[-0.04em] sm:text-[3.5rem]">
              Give the keyboard
              <br />
              <span style={{ color: ACCENT }}>back to the pharmacy.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[15px] text-zinc-500">
              Start a pilot on one workstation. Keep it only if the hours come back.
            </p>
            <Link
              to="/login"
              className="mt-10 inline-flex h-12 items-center gap-2 rounded-md px-8 text-[14px] font-bold text-[#050505] transition hover:brightness-110"
              style={{ background: ACCENT }}
            >
              Start 14-day pilot
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 text-[12px] text-zinc-600 sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} Pharma Flow</span>
          <span>For Canadian independent pharmacies · Clinical engines stay in your PMS</span>
        </div>
      </footer>
    </div>
  );
}
