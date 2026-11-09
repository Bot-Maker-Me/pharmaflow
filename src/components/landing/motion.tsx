import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

const EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";

/** One line of a headline that rises out of a mask when it scrolls into view. */
export function MaskLine({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.2);
  const reduced = useReducedMotion();
  const shown = inView || reduced;

  return (
    <span ref={ref} className={cn("-my-[0.07em] block overflow-hidden py-[0.07em]", className)}>
      <span
        className={cn(
          "block transition-transform duration-[950ms]",
          EASE,
          shown ? "translate-y-0" : "translate-y-[115%]",
        )}
        style={{ transitionDelay: shown && !reduced ? `${delay}ms` : "0ms" }}
      >
        {children}
      </span>
    </span>
  );
}

/** A 2px ink rule that draws itself left to right. The parent must be `relative`. */
export function Rule({ delay = 0, className }: { delay?: number; className?: string }) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.5);
  const reduced = useReducedMotion();
  const shown = inView || reduced;

  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        "absolute inset-x-0 top-0 block h-[2px] origin-left bg-pf-ink transition-transform duration-[1000ms]",
        EASE,
        shown ? "scale-x-100" : "scale-x-0",
        className,
      )}
      style={{ transitionDelay: shown && !reduced ? `${delay}ms` : "0ms" }}
    />
  );
}

/** Text that types itself out once it is on screen. Reserves its final size. */
export function Typed({
  text,
  className,
  delay = 0,
  speed = 28,
}: {
  text: string;
  className?: string;
  delay?: number;
  speed?: number;
}) {
  const { ref, inView } = useInView<HTMLPreElement>(0.4);
  const reduced = useReducedMotion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (reduced) {
      setCount(text.length);
      return;
    }
    if (!inView) return;
    let i = 0;
    let interval = 0;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        i += 1;
        setCount(i);
        if (i >= text.length) window.clearInterval(interval);
      }, speed);
    }, delay);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [inView, reduced, text, delay, speed]);

  return (
    <pre ref={ref} aria-label={text} className={className}>
      <span aria-hidden>{text.slice(0, count)}</span>
      <span aria-hidden className="opacity-0">
        {text.slice(count)}
      </span>
    </pre>
  );
}

/** A number whose digits roll up like an odometer when scrolled into view. */
export function Odometer({ value, className }: { value: string; className?: string }) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.3);
  const reduced = useReducedMotion();
  const on = inView || reduced;

  return (
    <span ref={ref} role="img" aria-label={value} className={cn("inline-flex items-end", className)}>
      {value.split("").map((ch, i) => {
        if (!/\d/.test(ch)) {
          return (
            <span key={i} aria-hidden className="inline-block h-[0.8em] leading-[0.8]">
              {ch}
            </span>
          );
        }
        const digit = Number(ch);
        return (
          <span key={i} aria-hidden className="relative inline-block h-[0.8em] overflow-hidden">
            <span
              className="flex flex-col transition-transform duration-[1700ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{
                transform: `translateY(${on ? -digit * 10 : 0}%)`,
                transitionDelay: on && !reduced ? `${i * 160}ms` : "0ms",
              }}
            >
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n} className="block h-[0.8em] leading-[0.8]">
                  {n}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Row of bar segments that grow from nothing when scrolled into view. */
export function Segments({
  segments,
  delay = 0,
}: {
  segments: { w: number; className: string; label: string }[];
  delay?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  const reduced = useReducedMotion();
  const on = inView || reduced;

  return (
    <div ref={ref} className="flex h-16 border-2 border-pf-ink text-[13px] font-semibold sm:text-[14px]">
      {segments.map((s, i) => (
        <div
          key={s.label}
          className={cn(
            "flex items-center overflow-hidden whitespace-nowrap transition-[width] duration-[1300ms]",
            EASE,
            i > 0 && "border-l-2 border-pf-ink",
            s.className,
          )}
          style={{ width: on ? `${s.w}%` : "0%", transitionDelay: on && !reduced ? `${delay + i * 170}ms` : "0ms" }}
        >
          <span className="px-3">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

/** A check mark whose stroke draws itself. */
export function DrawnCheck({ on, delay = 0, className }: { on: boolean; delay?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="2.6">
      <path
        d="M3 8.5l3.2 3L13 4.5"
        strokeLinecap="square"
        pathLength={1}
        style={{
          strokeDasharray: 1,
          strokeDashoffset: on ? 0 : 1,
          transition: `stroke-dashoffset 520ms ease-out ${delay}ms`,
        }}
      />
    </svg>
  );
}
