import { History, Inbox, Moon, Settings2, Sun } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { PmsSelector } from "@/components/PmsSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

/**
 * Quick action toolbar: Settings, PMS selector, dark/light mode and the recent
 * fax queue.
 */
export function QuickActions({ className }: { className?: string }) {
  const { documents, scripts, settings, updateSettings } = useAppStore();
  const navigate = useNavigate();
  const recent = documents.slice(0, 6);
  const isDark = settings.theme === "dark";

  const openDocument = (documentId: string) => {
    const first = scripts.find((script) => script.documentId === documentId);
    if (first) navigate(`/app/verify/${first.id}`);
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>

      <PmsSelector />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Toggle dark mode"
            onClick={() => updateSettings({ theme: isDark ? "light" : "dark" })}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isDark ? "Switch to light mode" : "Switch to dark mode"}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Settings"
            onClick={() => navigate("/app/settings")}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}
