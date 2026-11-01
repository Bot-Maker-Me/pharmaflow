import { cn } from "@/lib/utils";

interface MarqueeProps {
  items: string[];
  className?: string;
}

/** Endless horizontal ticker that pauses on hover and fades at both edges. */
export function Marquee({ items, className }: MarqueeProps) {
  const loop = [...items, ...items];

  return (
    <div
      className={cn(
        "overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]",
        className,
      )}
    >
      <div className="flex w-max animate-marquee gap-12 hover:[animation-play-state:paused] motion-reduce:animate-none">
        {loop.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="flex items-center gap-12 whitespace-nowrap text-sm font-medium text-slate-400 transition-colors hover:text-white"
          >
            {item}
            <span aria-hidden className="h-1 w-1 rounded-full bg-indigo-400/60" />
          </span>
        ))}
      </div>
    </div>
  );
}
