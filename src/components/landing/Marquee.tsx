import { cn } from "@/lib/utils";

interface MarqueeProps {
  items: string[];
  className?: string;
}

export function Marquee({ items, className }: MarqueeProps) {
  const loop = [...items, ...items];
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div className="flex w-max animate-marquee gap-10 motion-reduce:animate-none">
        {loop.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="shrink-0 text-[13px] font-medium tracking-wide text-white/45"
          >
            {item}
            <span className="ml-10 text-cyan-400/40">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}
