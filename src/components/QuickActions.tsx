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
    if (first) navigate(`/verify/${first.id}`);
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Inbox className="h-4 w-4" />
            <span className="hidden md:inline">Recent faxes</span>
            {recent.length ? (
              <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px]">
                {documents.length}
              </Badge>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[320px]">
          <DropdownMenuLabel>Recently received</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {recent.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No faxes ingested yet. Drop a PDF on the intake page.
            </p>
          ) : (
            recent.map((document) => {
              const docScripts = scripts.filter((script) => script.documentId === document.id);
              const pending = docScripts.filter((script) => script.status === "pending").length;
              const coverPages = document.pages.filter((page) => page.is_cover_page).length;
              return (
                <DropdownMenuItem
                  key={document.id}
                  onSelect={() => openDocument(document.id)}
                  className="items-start gap-3 py-2"
                >
                  <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {document.name}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {document.pageCount} page(s)
                      {coverPages ? ` · ${coverPages} cover` : ""} · {docScripts.length} Rx
                      {pending ? ` · ${pending} pending` : ""}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate("/queue")} className="gap-2">
            <Inbox className="h-4 w-4" />
            Open the prescription queue
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
            onClick={() => navigate("/settings")}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}
