import { MonitorCog } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PMS_PROFILES } from "@/lib/pms";
import type { PmsId } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

export function PmsSelector({ className }: { className?: string }) {
  const { settings, updateSettings } = useAppStore();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <MonitorCog className="hidden h-4 w-4 text-muted-foreground sm:block" />
      <Select
        value={settings.pms}
        onValueChange={(value) => updateSettings({ pms: value as PmsId })}
      >
        <SelectTrigger className="h-9 w-[190px]">
          <SelectValue placeholder="Select target PMS" />
        </SelectTrigger>
        <SelectContent>
          {PMS_PROFILES.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              <span className="flex items-center gap-2">
                <span className="font-medium">{profile.name}</span>
                <span className="text-xs text-muted-foreground">{profile.vendor}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
