import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

interface RotatingWordProps {
  words: string[];
  intervalMs?: number;
  className?: string;
}

/**
 * Cycles through words in place. All words share one grid cell (so height never
 * changes) while the wrapper animates its width to hug the current word, which
 * keeps the punctuation that follows snug against it.
 */
export function RotatingWord({ words, intervalMs = 2400, className }: RotatingWordProps) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [widths, setWidths] = useState<number[]>([]);
  const itemRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (reduced || words.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % words.length), intervalMs);
    return () => window.clearInterval(id);
  }, [reduced, words.length, intervalMs]);

  useLayoutEffect(() => {
    const measure = () =>
      setWidths(itemRefs.current.map((el) => (el ? el.getBoundingClientRect().width : 0)));
    measure();
    window.addEventListener("resize", measure);
    // Web fonts change glyph widths after first paint.
    void document.fonts?.ready.then(measure);
    return () => window.removeEventListener("resize", measure);
  }, [words]);

  const width = widths[index];

  return (
    <span
      className="inline-grid justify-items-start align-bottom transition-[width] duration-500 ease-out"
      style={width ? { width: `${width}px` } : undefined}
    >
      <span className="sr-only">{words[0]}</span>
      {words.map((word, i) => (
        <span
          key={word}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          aria-hidden
          className={cn(
            "w-max whitespace-nowrap [grid-area:1/1]",
            i === index ? "animate-word-in" : "invisible",
            className,
          )}
        >
          {word}
        </span>
      ))}
    </span>
  );
}
