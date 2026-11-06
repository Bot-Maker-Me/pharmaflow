import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/archivo/wdth-italic.css";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { HeroDemo } from "@/components/landing/HeroDemo";
import { cn } from "@/lib/utils";

/**
 * Pharma Flow landing. Built from the dispensary's own objects: fax paper,
 * Rx handwriting, prescription-vial amber and the Kroll terminal.
 */

const focus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pf-ink";

const nav = [
  { href: "#shift", label: "The problem" },
  { href: "#how", label: "How it works" },
  { href: "#safety", label: "Safety" },
  { href: "#pricing", label: "Pricing" },
];

const steps = [
  {
    title: "The fax arrives",
    body: "Send a multi-page PDF or a phone photo. Cover sheets are skipped and the prescription page is picked out for you.",
    specimen: ["3 pages in", "Page 2 kept, cover sheet skipped"],
  },
  {
    title: "The fields fill themselves",
    body: "Patient, prescriber, drug, strength, quantity and directions are read from the page in a few seconds, even in handwriting.",
    specimen: ["Patient   Whitfield, Eleanor", "Drug      Metformin 500 mg"],
  },
  {
    title: "Your tech checks it once",
    body: "The page and the fields sit side by side. The DIN is matched against Health Canada's drug database. A person always makes the call.",
    specimen: ["DIN 00226514", "Matches Apo-Metformin 500 mg"],
  },
  {
    title: "Kroll gets typed for you",
    body: "A small Windows app on the pharmacy computer presses the same keys your staff would, in the window that is already open.",
    specimen: ["F3  patient", "F5  drug", "F7  directions"],
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
    <span aria-hidden className="relative flex h-8 w-8 items-center justify-center bg-pf-ink">
      <span className="h-[3px] w-[18px] -rotate-45 bg-pf-amber" />
    </span>
  );
}

function PrimaryLink({ children, className }: { children: string; className?: string }) {
  return (
    <Link
      to="/login"
      className={cn(
        "inline-flex h-12 items-center justify-center border-2 border-pf-ink bg-pf-amber px-6 text-[15px] font-bold text-pf-ink transition-colors hover:bg-[#FF9C2E]",
        focus,
        className,
      )}
    >
      {children}
    </Link>
  );
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);

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
              <a key={item.href} href={item.href} className={cn("transition-colors hover:text-pf-ink", focus)}>
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
                "inline-flex h-10 items-center border-2 border-pf-ink bg-pf-ink px-4 text-[14px] font-bold text-pf-sheet transition-colors hover:bg-pf-amber hover:text-pf-ink",
                focus,
              )}
            >
              Start a pilot
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-5 pb-16 pt-28 sm:px-8 sm:pb-24 sm:pt-36">
        <div className="mx-auto max-w-[1240px]">
          <div className="grid items-end gap-8 lg:grid-cols-[auto_1fr] lg:gap-14">
            <h1 className="m-0 text-[clamp(4.4rem,15.5vw,12rem)] font-black leading-[0.86] tracking-[0.004em] [font-stretch:70%]">
              Fax in.
              <br />
              Kroll filled.
            </h1>

            <div className="pb-2 lg:max-w-[26rem]">
              <p className="m-0 text-[1.15rem] leading-[1.55] text-pf-slate sm:text-[1.2rem]">
                Pharma Flow reads the faxed prescription, lets your technician check it once, then types it into Kroll.
                Clinical checks stay where they belong, with your pharmacist.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
                <PrimaryLink>Start a 14-day pilot</PrimaryLink>
                <a href="#how" className={cn("text-[15px] font-semibold underline underline-offset-4", focus)}>
                  See how it works
                </a>
              </div>
            </div>
          </div>

          <div className="mt-12 sm:mt-16">
            <HeroDemo />
          </div>

          <p className="mb-0 mt-10 max-w-[44rem] text-[15px] leading-relaxed text-pf-slate">
            Works with TELUS Kroll, Propel Rx and WinRx. Every DIN is checked against the Health Canada Drug Product
            Database, and your data is stored in Canada.
          </p>
        </div>
      </section>

      {/* The problem, drawn as a shift */}
      <section id="shift" className="scroll-mt-16 border-t-2 border-pf-ink px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-[1240px]">
          <h2 className="m-0 max-w-[16ch] text-[clamp(2.8rem,7vw,5.5rem)] font-extrabold leading-[0.92] tracking-[0.002em] [font-stretch:74%]">
            Half the shift is still the keyboard.
          </h2>

          <div className="mt-12 space-y-8 sm:mt-16">
            <div>
              <p className="m-0 mb-2 text-[14px] font-semibold">Today, one technician</p>
              <div className="flex h-16 border-2 border-pf-ink text-[13px] font-semibold sm:text-[14px]">
                <div className="flex w-[72%] items-center bg-pf-amber px-3">Retyping scripts into the pharmacy software</div>
                <div className="flex w-[14%] items-center border-l-2 border-pf-ink bg-pf-sheet px-3">Checks</div>
                <div className="flex w-[14%] items-center border-l-2 border-pf-ink bg-pf-paper px-3">Patients</div>
              </div>
            </div>
            <div>
              <p className="m-0 mb-2 text-[14px] font-semibold">With Pharma Flow</p>
              <div className="flex h-16 border-2 border-pf-ink text-[13px] font-semibold sm:text-[14px]">
                <div className="flex w-[14%] items-center bg-pf-amber px-3">Typing</div>
                <div className="flex w-[30%] items-center border-l-2 border-pf-ink bg-pf-sheet px-3">One check per script</div>
                <div className="flex w-[56%] items-center border-l-2 border-pf-ink bg-pf-paper px-3">
                  Patients and the counter
                </div>
              </div>
            </div>
            <p className="m-0 text-[13px] text-pf-slate">An illustrative day. Proportions are not measured data.</p>
          </div>

          <dl className="m-0 mt-14 grid gap-x-10 gap-y-8 sm:mt-20 md:grid-cols-3">
            {[
              ["Hours of typing", "Six to eight hours a day on patient, doctor, drug, quantity and directions, for every script."],
              ["Messy pages", "Compressed faxes, cover sheets and handwriting mean constant rework and second looks."],
              ["Real safety risk", "A wrong DIN or patient ID is not a typo. It is a clinical incident waiting to happen."],
            ].map(([term, def]) => (
              <div key={term} className="border-t-2 border-pf-ink pt-4">
                <dt className="text-[1.15rem] font-bold">{term}</dt>
                <dd className="m-0 mt-2 max-w-[30rem] text-[16px] leading-[1.55] text-pf-slate">{def}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* How it works: a genuine sequence */}
      <section id="how" className="scroll-mt-16 border-t-2 border-pf-ink bg-pf-sheet px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-[1240px]">
          <h2 className="m-0 max-w-[14ch] text-[clamp(2.8rem,7vw,5.5rem)] font-extrabold leading-[0.92] tracking-[0.002em] [font-stretch:74%]">
            From fax to Kroll in four steps.
          </h2>

          <ol className="m-0 mt-12 list-none p-0 sm:mt-16">
            {steps.map((s, i) => (
              <li
                key={s.title}
                className="grid grid-cols-[3.5rem_1fr] gap-x-4 border-t-2 border-pf-ink py-8 md:grid-cols-[7rem_1fr_minmax(15rem,20rem)] md:gap-x-10 md:py-10"
              >
                <span
                  aria-hidden
                  className="text-[3.2rem] font-black leading-[0.9] text-pf-amber [font-stretch:68%] md:text-[5rem]"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="m-0 text-[1.5rem] font-bold leading-tight md:text-[1.9rem]">{s.title}</h3>
                  <p className="m-0 mt-3 max-w-[36rem] text-[16px] leading-[1.6] text-pf-slate md:text-[17px]">{s.body}</p>
                </div>
                <pre className="col-start-2 mt-5 self-start overflow-x-auto border border-pf-rule bg-pf-paper p-4 font-data text-[12.5px] leading-[1.8] text-pf-ink md:col-start-3 md:mt-0">
                  {s.specimen.join("\n")}
                </pre>
              </li>
            ))}
          </ol>
          <div className="border-t-2 border-pf-ink" />
        </div>
      </section>

      {/* Safety */}
      <section id="safety" className="scroll-mt-16 bg-pf-ink px-5 py-20 text-pf-sheet sm:px-8 sm:py-28">
        <div className="mx-auto max-w-[1240px]">
          <h2 className="m-0 max-w-[18ch] text-[clamp(2.8rem,7vw,5.5rem)] font-extrabold leading-[0.92] tracking-[0.002em] [font-stretch:74%]">
            Pharma Flow moves data. Clinical checks stay in Kroll.
          </h2>
          <p className="m-0 mt-6 max-w-[36rem] text-[1.1rem] leading-[1.55] text-pf-sheet/70">
            Drug utilization review, allergies and claims are not touched. Pharma Flow only carries intake details from
            the page to the screen, and a person confirms every script first.
          </p>

          <div className="mt-14 grid gap-10 sm:mt-20 md:grid-cols-3 md:gap-0">
            {guardrails.map((g, i) => (
              <div
                key={g.title}
                className={cn("md:px-8", i === 0 ? "md:pl-0" : "md:border-l md:border-pf-sheet/20", i === 2 && "md:pr-0")}
              >
                <h3 className="m-0 text-[1.25rem] font-bold">{g.title}</h3>
                <p className="m-0 mt-3 text-[16px] leading-[1.6] text-pf-sheet/70">{g.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16 px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto grid max-w-[1240px] items-end gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <div>
            <p className="m-0 text-[clamp(7rem,24vw,17rem)] font-black leading-[0.8] tracking-[0.002em] [font-stretch:70%]">
              $199
            </p>
            <p className="m-0 mt-4 text-[1.3rem] font-semibold">CAD per store, per month</p>
            <p className="m-0 mt-3 max-w-[28rem] text-[17px] leading-[1.55] text-pf-slate">
              One rate. Run a pilot first, and keep it only if the hours come back to the dispensary floor.
            </p>
          </div>

          <div>
            <ul className="m-0 list-none border-t-2 border-pf-ink p-0">
              {included.map((line) => (
                <li key={line} className="flex items-center gap-3 border-b border-pf-rule py-4 text-[16px] font-medium">
                  <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 shrink-0 text-pf-amber" fill="none" stroke="currentColor" strokeWidth="2.6">
                    <path d="M3 8.5l3.2 3L13 4.5" strokeLinecap="square" />
                  </svg>
                  {line}
                </li>
              ))}
            </ul>
            <PrimaryLink className="mt-8 w-full sm:w-auto">Start the free pilot</PrimaryLink>
          </div>
        </div>
      </section>

      {/* Closing band */}
      <section className="border-y-2 border-pf-ink bg-pf-amber px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-[1240px]">
          <h2 className="m-0 max-w-[14ch] text-[clamp(3.2rem,9vw,7.5rem)] font-black leading-[0.88] tracking-[0.002em] [font-stretch:70%]">
            Give the keyboard back to the pharmacy.
          </h2>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              to="/login"
              className={cn(
                "inline-flex h-14 items-center border-2 border-pf-ink bg-pf-ink px-8 text-[16px] font-bold text-pf-sheet transition-colors hover:bg-pf-sheet hover:text-pf-ink",
                focus,
              )}
            >
              Start a 14-day pilot
            </Link>
            <p className="m-0 text-[15px] font-medium">One workstation. No card. Cancel any time.</p>
          </div>
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
