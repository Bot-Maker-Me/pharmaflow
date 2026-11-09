import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/archivo/wdth-italic.css";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { HeroDemo } from "@/components/landing/HeroDemo";
import { DrawnCheck, MaskLine, Odometer, Rule, Segments, Typed } from "@/components/landing/motion";
import { Reveal } from "@/components/landing/Reveal";
import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useScrollProgress } from "@/hooks/use-scroll-progress";
import { cn } from "@/lib/utils";

/**
 * Pharma Flow landing. Built from the dispensary's own objects: fax paper,
 * Rx handwriting, prescription-vial amber and the Kroll terminal.
 */

const focus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pf-ink";

const h2 =
  "m-0 text-[clamp(2.8rem,7vw,5.5rem)] font-extrabold leading-[0.92] tracking-[0.002em] [font-stretch:74%]";

const nav = [
  { href: "#shift", label: "The problem" },
  { href: "#how", label: "How it works" },
  { href: "#safety", label: "Safety" },
  { href: "#pricing", label: "Pricing" },
];

const flow = ["Fax in", "Fields read", "One check", "Kroll filled", "Next fax"];

const steps = [
  {
    title: "The fax arrives",
    body: "Send a multi-page PDF or a phone photo. Cover sheets are skipped and the prescription page is picked out for you.",
    specimen: "3 pages in\nPage 2 kept, cover sheet skipped",
  },
  {
    title: "The fields fill themselves",
    body: "Patient, prescriber, drug, strength, quantity and directions are read from the page in a few seconds, even in handwriting.",
    specimen: "Patient   Whitfield, Eleanor\nDrug      Metformin 500 mg",
  },
  {
    title: "Your tech checks it once",
    body: "The page and the fields sit side by side. The DIN is matched against Health Canada's drug database. A person always makes the call.",
    specimen: "DIN 00226514\nMatches Apo-Metformin 500 mg",
  },
  {
    title: "Kroll gets typed for you",
    body: "A small Windows app on the pharmacy computer presses the same keys your staff would, in the window that is already open.",
    specimen: "F3  patient\nF5  drug\nF7  directions",
  },
];

const guardrails = [
  {
    title: "Built for a Canadian dispensary",
    body: "DINs, provincial health cards, Latin directions turned into plain English, and Kroll keystroke maps. Not a generic text reader.",
  },
  {
    title: "Learns from your staff",
    body: "When a tech fixes a field, the next read gets better. Shadow mode also learns from what was typed into Kroll by hand.",
  },
  {
    title: "Every store is separate",
    body: "Each pharmacy has its own queue, agent keys and learnings, and none of it is visible to another store.",
  },
];

const included = [
  "Unlimited intake on the pilot workstation",
  "Prescription reading and DIN checks",
  "Kroll, Propel Rx and WinRx profiles",
  "The local Windows app",
  "A 14-day pilot with no card",
];

function Mark() {
  return (
    <span aria-hidden className="group relative flex h-8 w-8 items-center justify-center bg-pf-ink">
      <span className="h-[3px] w-[18px] -rotate-45 bg-pf-amber transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-[135deg]" />
    </span>
  );
}

function PrimaryLink({ children, className }: { children: string; className?: string }) {
  return (
    <Link
      to="/login"
      className={cn(
        "pf-wipe inline-flex h-12 items-center justify-center border-2 border-pf-ink bg-pf-amber px-6 text-[15px] font-bold text-pf-ink",
        focus,
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Scrolling strip of the workflow, like a ticker on the dispensary wall. */
function Ticker() {
  const items = [...flow, ...flow, ...flow, ...flow];
  return (
    <div aria-hidden className="overflow-hidden border-y-2 border-pf-ink bg-pf-ink py-5 sm:py-6">
      <div className="flex w-max animate-marquee [animation-duration:38s] hover:[animation-play-state:paused] motion-reduce:animate-none">
        {items.map((text, i) => (
          <span
            key={i}
            className="flex shrink-0 items-center gap-8 pr-8 text-[2.6rem] font-black leading-none text-pf-sheet [font-stretch:70%] sm:text-[3.8rem]"
          >
            {text}
            <span className="h-[3px] w-10 -rotate-45 bg-pf-amber" />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Thirty day strip: 14 days of pilot, then billing, filling in one day at a time. */
function DaysStrip() {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  const reduced = useReducedMotion();
  const on = inView || reduced;

  return (
    <div ref={ref} className="mt-12 max-w-[34rem]">
      <div aria-hidden className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[3px]">
        {Array.from({ length: 30 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "block h-9 origin-bottom transition-[background-color,transform] duration-500",
              on ? (i < 14 ? "scale-y-100 bg-pf-ink" : "scale-y-100 bg-pf-amber") : "scale-y-[0.3] bg-pf-rule",
            )}
            style={{ transitionDelay: on && !reduced ? `${i * 60}ms` : "0ms" }}
          />
        ))}
      </div>
      <div className="mt-3 flex gap-3 text-[14px] leading-snug">
        <p className="m-0 shrink-0 basis-[46.6%] font-semibold">Days 1 to 14: the pilot, no card</p>
        <p className="m-0 text-pf-slate">Day 15 on: $199 a month if you keep it</p>
      </div>
    </div>
  );
}

function IncludedList() {
  const { ref, inView } = useInView<HTMLUListElement>(0.3);
  const reduced = useReducedMotion();
  const on = inView || reduced;

  return (
    <ul ref={ref} className="relative m-0 list-none p-0">
      <Rule />
      {included.map((line, i) => (
        <li
          key={line}
          className={cn(
            "flex items-center gap-3 border-b border-pf-rule py-4 text-[16px] font-medium transition-[opacity,transform] duration-700",
            i === 0 && "mt-[2px]",
            on ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0",
          )}
          style={{ transitionDelay: on && !reduced ? `${200 + i * 110}ms` : "0ms" }}
        >
          <DrawnCheck on={on} delay={350 + i * 110} className="h-4 w-4 shrink-0 text-pf-amber" />
          {line}
        </li>
      ))}
    </ul>
  );
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const { progress } = useScrollProgress([]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
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
    <div className="min-h-screen overflow-x-clip bg-pf-paper font-display text-pf-ink antialiased selection:bg-pf-amber/40">
      {/* Reading progress */}
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-pf-amber"
        style={{ transform: `scaleX(${progress})` }}
      />

      {/* Nav */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-200",
          scrolled ? "border-pf-rule bg-pf-paper/90 backdrop-blur-md" : "border-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 sm:px-8">
          <Link to="/" className={cn("flex items-center gap-3", focus)}>
            <Mark />
            <span className="text-[17px] font-bold tracking-tight">Pharma Flow</span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-8 text-[14px] font-medium text-pf-slate md:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={cn(
                  "relative transition-colors hover:text-pf-ink",
                  "after:absolute after:-bottom-1.5 after:left-0 after:h-[2px] after:w-full after:origin-left after:scale-x-0 after:bg-pf-amber after:transition-transform after:duration-300 hover:after:scale-x-100",
                  focus,
                )}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-5">
            <Link
              to="/login"
              className={cn("hidden text-[14px] font-medium text-pf-slate transition-colors hover:text-pf-ink sm:inline", focus)}
            >
              Sign in
            </Link>
            <Link
              to="/login"
              className={cn(
                "pf-wipe-light inline-flex h-10 items-center border-2 border-pf-ink bg-pf-ink px-4 text-[14px] font-bold text-pf-sheet",
                "hover:!bg-pf-amber",
                focus,
              )}
            >
              Start a pilot
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-5 pb-14 pt-28 sm:px-8 sm:pb-20 sm:pt-36">
        <div className="mx-auto max-w-[1240px]">
          <div className="grid items-end gap-8 lg:grid-cols-[auto_1fr] lg:gap-14">
            <h1 className="m-0 text-[clamp(4.4rem,15.5vw,12rem)] font-black leading-[0.86] tracking-[0.004em] [font-stretch:70%]">
              <MaskLine>
                <span className="whitespace-nowrap">Fax in.</span>
              </MaskLine>
              <MaskLine delay={150}>
                <span className="whitespace-nowrap">
                  Kroll filled.
                  <span
                    aria-hidden
                    className="pf-blink ml-[0.07em] inline-block h-[0.68em] w-[0.3em] bg-pf-amber align-baseline"
                  />
                </span>
              </MaskLine>
            </h1>

            <div className="pb-2 lg:max-w-[26rem]">
              <Reveal delay={450}>
                <p className="m-0 text-[1.15rem] leading-[1.55] text-pf-slate sm:text-[1.2rem]">
                  Pharma Flow reads the faxed prescription, lets your technician check it once, then types it into
                  Kroll. Clinical checks stay where they belong, with your pharmacist.
                </p>
              </Reveal>
              <Reveal delay={600}>
                <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <PrimaryLink>Start a 14-day pilot</PrimaryLink>
                  <a href="#how" className={cn("text-[15px] font-semibold underline underline-offset-4", focus)}>
                    See how it works
                  </a>
                </div>
              </Reveal>
            </div>
          </div>

          <Reveal delay={700} className="mt-12 sm:mt-16">
            <HeroDemo />
          </Reveal>

          <p className="mb-0 mt-10 max-w-[44rem] text-[15px] leading-relaxed text-pf-slate">
            Works with TELUS Kroll, Propel Rx and WinRx. Every DIN is checked against the Health Canada Drug Product
            Database, and your data is stored in Canada.
          </p>
        </div>
      </section>

      <Ticker />

      {/* The problem, drawn as a shift */}
      <section id="shift" className="scroll-mt-16 px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-[1240px]">
          <h2 className={cn(h2, "max-w-[16ch]")}>
            <MaskLine>Half the shift is</MaskLine>
            <MaskLine delay={120}>still the keyboard.</MaskLine>
          </h2>

          <div className="mt-12 space-y-8 sm:mt-16">
            <div>
              <p className="m-0 mb-2 text-[14px] font-semibold">Today, one technician</p>
              <Segments
                segments={[
                  { w: 72, className: "bg-pf-amber", label: "Retyping scripts into the pharmacy software" },
                  { w: 14, className: "bg-pf-sheet", label: "Checks" },
                  { w: 14, className: "bg-pf-paper", label: "Patients" },
                ]}
              />
            </div>
            <div>
              <p className="m-0 mb-2 text-[14px] font-semibold">With Pharma Flow</p>
              <Segments
                delay={650}
                segments={[
                  { w: 14, className: "bg-pf-amber", label: "Typing" },
                  { w: 30, className: "bg-pf-sheet", label: "One check per script" },
                  { w: 56, className: "bg-pf-paper", label: "Patients and the counter" },
                ]}
              />
            </div>
            <p className="m-0 text-[13px] text-pf-slate">An illustrative day. Proportions are not measured data.</p>
          </div>

          <dl className="m-0 mt-14 grid gap-x-10 gap-y-8 sm:mt-20 md:grid-cols-3">
            {[
              ["Hours of typing", "Six to eight hours a day on patient, doctor, drug, quantity and directions, for every script."],
              ["Messy pages", "Compressed faxes, cover sheets and handwriting mean constant rework and second looks."],
              ["Real safety risk", "A wrong DIN or patient ID is not a typo. It is a clinical incident waiting to happen."],
            ].map(([term, def], i) => (
              <div key={term} className="relative pt-4">
                <Rule delay={i * 140} />
                <Reveal delay={i * 140 + 150}>
                  <dt className="text-[1.15rem] font-bold">{term}</dt>
                  <dd className="m-0 mt-2 max-w-[30rem] text-[16px] leading-[1.55] text-pf-slate">{def}</dd>
                </Reveal>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* How it works: a genuine sequence */}
      <section id="how" className="scroll-mt-16 border-t-2 border-pf-ink bg-pf-sheet px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-[1240px]">
          <h2 className={cn(h2, "max-w-[14ch]")}>
            <MaskLine>From fax to Kroll</MaskLine>
            <MaskLine delay={120}>in four steps.</MaskLine>
          </h2>

          <ol className="m-0 mt-12 list-none p-0 sm:mt-16">
            {steps.map((s, i) => (
              <li
                key={s.title}
                className="relative grid grid-cols-[3.5rem_1fr] gap-x-4 py-8 md:grid-cols-[7rem_1fr_minmax(15rem,20rem)] md:gap-x-10 md:py-10"
              >
                <Rule />
                <Reveal variant="left">
                  <span
                    aria-hidden
                    className="block text-[3.2rem] font-black leading-[0.9] text-pf-amber [font-stretch:68%] md:text-[5rem]"
                  >
                    {i + 1}
                  </span>
                </Reveal>
                <Reveal delay={120}>
                  <h3 className="m-0 text-[1.5rem] font-bold leading-tight md:text-[1.9rem]">{s.title}</h3>
                  <p className="m-0 mt-3 max-w-[36rem] text-[16px] leading-[1.6] text-pf-slate md:text-[17px]">{s.body}</p>
                </Reveal>
                <Typed
                  text={s.specimen}
                  delay={500}
                  className="col-start-2 m-0 mt-5 self-start overflow-x-auto border border-pf-rule bg-pf-paper p-4 font-data text-[12.5px] leading-[1.8] text-pf-ink md:col-start-3 md:mt-0"
                />
              </li>
            ))}
          </ol>
          <div className="relative h-0">
            <Rule />
          </div>
        </div>
      </section>

      {/* Safety */}
      <section id="safety" className="scroll-mt-16 bg-pf-ink px-5 py-20 text-pf-sheet sm:px-8 sm:py-28">
        <div className="mx-auto max-w-[1240px]">
          <h2 className={cn(h2, "max-w-[18ch]")}>
            <MaskLine>Pharma Flow moves</MaskLine>
            <MaskLine delay={110}>data. Clinical checks</MaskLine>
            <MaskLine delay={220}>stay in Kroll.</MaskLine>
          </h2>
          <Reveal delay={250}>
            <p className="m-0 mt-6 max-w-[36rem] text-[1.1rem] leading-[1.55] text-pf-sheet/70">
              Drug utilization review, allergies and claims are not touched. Pharma Flow only carries intake details
              from the page to the screen, and a person confirms every script first.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-10 sm:mt-20 md:grid-cols-3 md:gap-0">
            {guardrails.map((g, i) => (
              <Reveal
                key={g.title}
                delay={i * 140}
                className={cn("md:px-8", i === 0 ? "md:pl-0" : "md:border-l md:border-pf-sheet/20", i === 2 && "md:pr-0")}
              >
                <h3 className="m-0 text-[1.25rem] font-bold">{g.title}</h3>
                <p className="m-0 mt-3 text-[16px] leading-[1.6] text-pf-sheet/70">{g.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16 px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto grid max-w-[1240px] items-start gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <div>
            <p className="m-0 text-[clamp(7rem,24vw,17rem)] font-black leading-[0.8] tracking-[0.002em] [font-stretch:70%]">
              <Odometer value="$199" />
            </p>
            <Reveal delay={300}>
              <p className="m-0 mt-5 text-[1.3rem] font-semibold">CAD per store, per month</p>
              <p className="m-0 mt-3 max-w-[28rem] text-[17px] leading-[1.55] text-pf-slate">
                One rate. Run a pilot first, and keep it only if the hours come back to the dispensary floor.
              </p>
            </Reveal>
            <DaysStrip />
          </div>

          <div className="lg:pt-4">
            <IncludedList />
            <Reveal delay={700}>
              <PrimaryLink className="mt-8 w-full sm:w-auto">Start the free pilot</PrimaryLink>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Closing band */}
      <section className="border-y-2 border-pf-ink bg-pf-amber px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-[1240px]">
          <h2 className="m-0 text-[clamp(3.2rem,9vw,7.5rem)] font-black leading-[0.88] tracking-[0.002em] [font-stretch:70%]">
            <MaskLine>Give the keyboard</MaskLine>
            <MaskLine delay={120}>back to the pharmacy.</MaskLine>
          </h2>
          <Reveal delay={350}>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <Link
                to="/login"
                className={cn(
                  "pf-wipe-light inline-flex h-14 items-center border-2 border-pf-ink bg-pf-ink px-8 text-[16px] font-bold text-pf-sheet",
                  focus,
                )}
              >
                Start a 14-day pilot
              </Link>
              <p className="m-0 text-[15px] font-medium">One workstation. No card. Cancel any time.</p>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-[1240px] flex-col justify-between gap-3 text-[13px] text-pf-slate sm:flex-row">
          <span>© {new Date().getFullYear()} Pharma Flow</span>
          <span>Made for Canadian independent pharmacies. Clinical engines stay in your pharmacy software.</span>
        </div>
      </footer>
    </div>
  );
}
