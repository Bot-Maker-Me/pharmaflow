import type { ReactNode } from "react";

import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

type Variant = "up" | "left" | "right" | "scale" | "fade";

const hidden: Record<Variant, string> = {
  up: "translate-y-8",
  left: "-translate-x-8",
  right: "translate-x-8",
  scale: "scale-95",
  fade: "",
};

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Delay in ms, used to stagger siblings. */
  delay?: number;
  variant?: Variant;
  as?: "div" | "li";
}

/** Fades and slides its children in the first time they scroll into view. */
export function Reveal({ children, className, delay = 0, variant = "up", as = "div" }: RevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  const shown = inView || reduced;
  const Tag = as as "div";

  return (
    <Tag
      ref={ref}
      style={{ transitionDelay: shown && !reduced ? `${delay}ms` : "0ms" }}
      className={cn(
        "transition-all duration-700 ease-out will-change-transform",
        shown
          ? "translate-x-0 translate-y-0 scale-100 opacity-100"
          : cn("opacity-0", hidden[variant]),
        className,
      )}
    >
      {children}
    </Tag>
  );
}
