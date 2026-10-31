import { MonitorSmartphone, PlugZap, Radio, WifiOff } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/services/agent";

const META: Record<
  AgentStatus,
  { label: string; detail: string; dot: string; chip: string; icon: typeof Radio }
> = {
  connected: {
    label: "Helper connected",
    detail: "Live WebSocket session with the PharmFlow desktop helper.",
    dot: "bg-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: PlugZap,
  },
  connecting: {
    label: "Connecting…",
    detail: "Attempting to reach the local desktop helper.",
    dot: "bg-amber-500",
    chip: "border-amber-200 bg-amber-50 text-amber-700",
    icon: Radio,
  },
  simulated: {
    label: "Helper offline — simulate",
    detail:
      "No executable answered on the helper port. Keystrokes are simulated locally so you can still validate the data.",
    dot: "bg-slate-400",
    chip: "border-border bg-secondary text-secondary-foreground",
    icon: MonitorSmartphone,
  },
  disconnected: {
    label: "Helper disconnected",
    detail: "The desktop helper bridge is not running.",
    dot: "bg-slate-400",
    chip: "border-border bg-secondary text-secondary-foreground",
    icon: WifiOff,
  },
};

export function AgentStatusPill({ className }: { className?: string }) {
  const { agentStatus, settings } = useAppStore();
  const meta = META[agentStatus];
  const Icon = meta.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex cursor-default items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
            meta.chip,
            className,
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{meta.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-semibold">{meta.label}</p>
        <p className="mt-1 opacity-80">{meta.detail}</p>
        <p className="mt-1 font-mono text-[11px] opacity-70">{settings.agentUrl}</p>
      </TooltipContent>
    </Tooltip>
  );
}
