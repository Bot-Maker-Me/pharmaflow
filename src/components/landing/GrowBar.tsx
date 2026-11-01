import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

interface GrowBarProps {
  /** Final width, 0–100. */
  percent: number;
  barClassName: string;
  delay?: number;
}

/** Progress bar that fills from 0 when scrolled into view. */
export function GrowBar({ percent, barClassName, delay = 0 }: GrowBarProps) {
  const { ref, inView } = useInView<HTMLDivElement>(0.5);
  const reduced = useReducedMotion();
  const width = inView || reduced ? percent : 0;

  return (
    <div ref={ref} className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
      <div
        className={cn("h-full rounded-full transition-[width] duration-1000 ease-out", barClassName)}
        style={{ width: `${width}%`, transitionDelay: `${delay}ms` }}
      />
    </div>
  );
}
