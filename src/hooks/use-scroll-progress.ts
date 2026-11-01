import { useEffect, useState } from "react";

/** Page scroll position as 0–1 plus the id of the section currently in view. */
export function useScrollProgress(sectionIds: string[]) {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const key = sectionIds.join("|");

  useEffect(() => {
    const ids = key.split("|").filter(Boolean);
    let frame = 0;

    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);

      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.35) {
          current = id;
        }
      }
      setActive(current);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [key]);

  return { progress, active };
}
