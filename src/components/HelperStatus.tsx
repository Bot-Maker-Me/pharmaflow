import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type { HelperStatus as HelperStatusValue } from "@/services/agent";

/**
 * Local connection status indicator.
 * ● green — helper reachable on /health
 * ○ red   — helper offline (keystrokes are simulated)
 */
const META: Record<
  HelperStatusValue,
  { label: string; dot: string; text: string; detail: string; filled: boolean }
> = {
  connected: {
    label: "Local Helper Connected",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
    detail: "The desktop helper is listening and will type prescriptions straight into the PMS.",
    filled: true,
  },
  checking: {
    label: "Checking Local Helper…",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    detail: "Probing the helper's /health endpoint.",
    filled: true,
  },
  offline: {
    label: "Local Helper Offline",
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-400",
    detail:
      "No helper answered on this address. Keystroke pushes are simulated locally so you can still validate the data.",
    filled: false,
  },
};

export function HelperStatus({ className }: { className?: string }) {
  const { helperStatus, helperInfo, settings } = useAppStore();
  const meta = META[helperStatus];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex cursor-default items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium",
            meta.text,
            className,
          )}
        >
          <span className="relative flex h-2.5 w-2.5 items-center justify-center">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                meta.filled ? meta.dot : "border-2 border-current bg-transparent",
              )}
            />
            {helperStatus === "connected" ? (
              <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-emerald-500/60" />
            ) : null}
          </span>
          <span className="whitespace-nowrap">{meta.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-semibold">{meta.label}</p>
        <p className="mt-1 opacity-80">{meta.detail}</p>
        <p className="mt-1 font-mono text-[11px] opacity-70">{settings.helperUrl}</p>
        {helperInfo.version ? (
          <p className="mt-1 text-[11px] opacity-70">
            helper v{helperInfo.version}
            {helperInfo.keystrokesAvailable === false ? " · keystrokes unavailable" : ""}
          </p>
        ) : null}
        {helperInfo.checkedAt ? (
          <p className="mt-1 text-[11px] opacity-60">
            checked {new Date(helperInfo.checkedAt).toLocaleTimeString()}
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
