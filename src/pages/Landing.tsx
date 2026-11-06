import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  FileText,
  Lock,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

import { AnimatedNumber } from "@/components/landing/AnimatedNumber";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { Marquee } from "@/components/landing/Marquee";
import { Reveal } from "@/components/landing/Reveal";
import { RotatingWord } from "@/components/landing/RotatingWord";
import { cn } from "@/lib/utils";

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

/** Static brutalist background — no continuous blur animations. */
function BrutalistBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Hard cyan radial */}
      <div
        className="absolute -top-24 left-1/2 h-[520px] w-[900px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(34,211,238,0.22) 0%, transparent 65%)",
        }}
      />
      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "linear-gradient(to bottom, black 0%, transparent 75%)",
        }}
      />
      {/* Diagonal slash bars */}
      <div
        className="absolute -right-10 top-24 h-[420px] w-[220px] rotate-12 border border-white/10 bg-white/[0.03]"
        style={{ clipPath: "polygon(20% 0, 100% 0, 80% 100%, 0 100%)" }}
      />
      <div className="absolute left-[-40px] top-40 h-40 w-40 rotate-45 border-2 border-cyan-400/25" />
      <div className="absolute right-16 top-56 h-24 w-24 -rotate-6 border border-white/20" />
      {/* Oversized type stamp */}
      <p className="absolute -left-4 top-28 select-none text-[clamp(4rem,14vw,9rem)] font-black leading-none tracking-tighter text-white/[0.04]">
        RX
      </p>
      <p className="absolute bottom-8 right-4 select-none text-[clamp(3rem,10vw,6rem)] font-black leading-none tracking-tighter text-white/[0.05]">
        FLOW
      </p>
      {/* Corner brackets */}
      <div className="absolute left-6 top-24 h-16 w-16 border-l-2 border-t-2 border-cyan-400/40" />
      <div className="absolute right-6 top-24 h-16 w-16 border-r-2 border-t-2 border-white/20" />
      {/* Thin rules */}
      <div className="absolute left-0 right-0 top-[28%] h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
    </div>
  );
}

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
    <div className="min-h-screen overflow-x-clip bg-[#09090B] text-[#FAFAFA] antialiased selection:bg-cyan-400/30">
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-colors duration-200",
          scrolled ? "border-b border-white/10 bg-[#09090B]/80 backdrop-blur-md" : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-teal-500 text-[11px] font-bold tracking-wide text-[#09090B]">
              PF
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Pharma Flow</span>
          </Link>

          <nav className="hidden items-center gap-8 text-[13px] text-white/55 md:flex">
            {nav.map((item) => (
              <a key={item.href} href={item.href} className="transition hover:text-white">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden text-[13px] text-white/55 transition hover:text-white sm:inline">
              Sign in
            </Link>
            <Link
              to="/login"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-[#09090B] transition hover:bg-white/90"
            >
              Start pilot
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative pt-28 pb-8 sm:pt-36 sm:pb-12">
        <BrutalistBackdrop />

        <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] text-white/70">
              <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
              Built for Canadian independent pharmacies
            </div>
          </Reveal>

          <Reveal delay={60}>
            <h1 className="mt-6 max-w-[18ch] text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[4rem] lg:text-[4.75rem]">
              Stop retyping{" "}
              <RotatingWord words={heroWords} className="text-cyan-300" />.
              <span className="mt-1 block text-white/40">Get hours back on the floor.</span>
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="mt-6 max-w-lg text-[1.05rem] leading-relaxed text-white/55">
              Pharma Flow reads faxed prescriptions, staff verify once, then a local agent enters them
              into Kroll — without replacing clinical checks.
            </p>
          </Reveal>

          <Reveal delay={180}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/login"
                className="group inline-flex h-11 items-center gap-2 rounded-full bg-cyan-400 px-6 text-[14px] font-semibold text-[#09090B] transition hover:bg-cyan-300"
              >
                Start 14-day pilot
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#how"
                className="inline-flex h-11 items-center rounded-full border border-white/15 px-5 text-[14px] font-medium text-white/80 transition hover:border-white/30 hover:bg-white/5"
              >
                See how it works
              </a>
            </div>
            <p className="mt-4 text-[12px] text-white/35">No card required · One workstation · Cancel anytime</p>
          </Reveal>

          <Reveal delay={240} variant="scale">
            <div className="mt-14 sm:mt-16">
              <HeroDemo />
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-y border-white/10 py-4">
        <Marquee items={worksWith} />
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-5 py-12 sm:grid-cols-4 sm:px-6">
          {[
            { to: 8, prefix: "6–", suffix: "h", label: "Saved per tech / day" },
            { to: 3, prefix: "~", suffix: "s", label: "Typical extract" },
            { to: 100, prefix: "", suffix: "%", label: "Store isolation" },
            { to: 199, prefix: "$", suffix: "", label: "CAD / store / mo" },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 80}>
              <p className="text-3xl font-semibold tracking-tight sm:text-4xl">
                <AnimatedNumber to={s.to} prefix={s.prefix} suffix={s.suffix} />
              </p>
              <p className="mt-1.5 text-[13px] text-white/40">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="product" className="scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <Reveal>
            <p className="text-[12px] font-medium uppercase tracking-[0.2em] text-cyan-300/80">The problem</p>
            <h2 className="mt-3 max-w-[16ch] text-[2.25rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[3rem]">
              Half the shift is still the keyboard.
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/50">
              Handwritten and faxed scripts pile up. Technicians retype the same fields into legacy
              Windows software while the queue waits.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {[
              {
                t: "Hours of typing",
                b: "6–8 hours a day on patient, doctor, drug, qty, and SIG — for every script.",
              },
              {
                t: "Messy pages",
                b: "Compression, covers, and handwriting force constant re-work and second looks.",
              },
              {
                t: "Safety risk",
                b: "A wrong DIN or patient ID is not a UI bug. It is a clinical incident waiting.",
              },
            ].map((card, i) => (
              <Reveal key={card.t} delay={i * 90}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition duration-300 hover:border-cyan-400/30 hover:bg-white/[0.05]">
                  <div className="mb-4 h-1 w-10 rounded-full bg-cyan-400/80" />
                  <h3 className="text-[1.05rem] font-semibold">{card.t}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/50">{card.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="scroll-mt-20 border-t border-white/10 bg-[#0C0C0E] py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <Reveal>
            <p className="text-[12px] font-medium uppercase tracking-[0.2em] text-cyan-300/80">How it works</p>
            <h2 className="mt-3 text-[2.25rem] font-semibold tracking-[-0.03em] sm:text-[3rem]">
              Fax in. Kroll filled.
            </h2>
          </Reveal>

          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            {story.map((s, i) => (
              <Reveal key={s.step} delay={i * 80}>
                <div className="group flex gap-5 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-6 transition hover:border-cyan-400/25">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20">
                    <s.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium tracking-widest text-white/35">{s.step}</p>
                    <h3 className="mt-1 text-[1.1rem] font-semibold">{s.title}</h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-white/50">{s.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <Reveal>
            <p className="text-center text-[12px] font-medium uppercase tracking-[0.2em] text-cyan-300/80">Product</p>
            <h2 className="mx-auto mt-3 max-w-[22ch] text-center text-[2rem] font-semibold tracking-[-0.03em] sm:text-[2.5rem]">
              Pipeline A (SQL) + Pipeline B (fax) — verify side by side.
            </h2>
          </Reveal>

          <Reveal delay={100} variant="scale">
            <div className="relative mx-auto mt-12 max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#121214] shadow-2xl shadow-black/50">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                <span className="ml-3 text-xs text-white/40">Verification · side by side</span>
              </div>
              <div className="grid md:grid-cols-2">
                <div className="border-r border-white/5 bg-[#1a1a1c] p-6">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">Source panel</p>
                  <div className="mt-3 aspect-[3/4] rounded-lg bg-[#0f172a] p-5 ring-1 ring-cyan-400/30">
                    <p className="text-xs font-bold text-cyan-300">KROLL SQL SNAPSHOT</p>
                    <div className="mt-4 space-y-3 text-[11px]">
                      {["PATIENT", "DRUG ID", "QTY", "SIG"].map((k) => (
                        <div key={k} className="flex justify-between border-b border-white/10 pb-2">
                          <span className="text-white/40">{k}</span>
                          <span className="font-mono text-white/80">••••</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-3 p-6">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">Editable fields</p>
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
                      <span className="text-xs text-white/40">{k}</span>
                      <span className="text-sm font-medium">{v}</span>
                    </div>
                  ))}
                  <div className="pt-2">
                    <div className="flex h-10 items-center justify-center rounded-full bg-cyan-400 text-[13px] font-semibold text-[#09090B]">
                      Push to Kroll
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="safety" className="scroll-mt-20 border-t border-white/10 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <Reveal>
              <p className="text-[12px] font-medium uppercase tracking-[0.2em] text-cyan-300/80">Guardrails</p>
              <h2 className="mt-3 text-[2rem] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[2.5rem]">
                Outside clinical decisioning. By design.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-white/50">
                Pharma Flow moves intake data. DUR, allergies, and claims stay inside Kroll where they belong.
              </p>
            </Reveal>
            <div className="space-y-4">
              {features.map((f, i) => (
                <Reveal key={f.title} delay={i * 80}>
                  <div className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
                    <Lock className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
                    <div>
                      <h3 className="font-semibold">{f.title}</h3>
                      <p className="mt-1.5 text-[14px] leading-relaxed text-white/50">{f.body}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 border-t border-white/10 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <p className="text-[12px] font-medium uppercase tracking-[0.2em] text-cyan-300/80">Pricing</p>
              <p className="mt-4 text-[4rem] font-semibold tracking-tight sm:text-[5rem]">
                <AnimatedNumber to={199} prefix="$" />
              </p>
              <p className="text-[1.05rem] text-white/45">CAD per store / month</p>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/50">
                One rate. Pilot first. Keep it only if the hours return to the dispensary floor.
              </p>
              <Link
                to="/login"
                className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-[#09090B] transition hover:bg-white/90"
              >
                Start free pilot
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
            <Reveal delay={100}>
              <ul className="space-y-1 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
                {[
                  "Unlimited intake on the pilot workstation",
                  "Extraction + DIN verification",
                  "Kroll · Propel Rx · WinRx profiles",
                  "Local Windows agent",
                  "14-day pilot — no card",
                ].map((line) => (
                  <li key={line} className="flex items-center gap-3 rounded-xl px-4 py-3.5 text-[14px] text-white/75">
                    <Check className="h-4 w-4 shrink-0 text-cyan-300" />
                    {line}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 py-20">
        <div className="mx-auto max-w-6xl px-5 text-center sm:px-6">
          <Reveal>
            <h2 className="text-[2rem] font-semibold tracking-[-0.03em] sm:text-[2.75rem]">
              Give the keyboard back to the pharmacy.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] text-white/50">
              Start a pilot on one workstation. Keep it only if the hours come back.
            </p>
            <Link
              to="/login"
              className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-cyan-400 px-7 text-[14px] font-semibold text-[#09090B] transition hover:bg-cyan-300"
            >
              Start 14-day pilot
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 text-[12px] text-white/35 sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} Pharma Flow</span>
          <span>For Canadian independent pharmacies · Clinical engines stay in your PMS</span>
        </div>
      </footer>
    </div>
  );
}
