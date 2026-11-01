import { useEffect, useState } from "react";

import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

interface AnimatedNumberProps {
  to: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
  className?: string;
}

/** Counts up from 0 to `to` once the number scrolls into view. */
export function AnimatedNumber({
  to,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1400,
  className,
}: AnimatedNumberProps) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.4);
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView || reduced) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(to * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, to, duration]);

  const shown = reduced ? to : value;

  return (
    <span ref={ref} className={className}>
      <span className="tabular-nums">
        {prefix}
        {shown.toFixed(decimals)}
        {suffix}
      </span>
    </span>
  );
}
