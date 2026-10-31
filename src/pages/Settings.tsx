import { Bot, MonitorSmartphone, PlugZap, RotateCcw, ShieldCheck, Terminal } from "lucide-react";
import { toast } from "sonner";

import { AgentStatusPill } from "@/components/AgentStatusPill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { PMS_PROFILES } from "@/lib/pms";
import { EXTRACTION_SYSTEM_PROMPT } from "@/services/vision";
import { AGENT_PORT } from "@/services/agent";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type { PmsId } from "@/lib/types";

export default function Settings() {
  const { settings, updateSettings, reconnectAgent, resetQueue, agentStatus } = useAppStore();

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 p-4 lg:p-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="h-4 w-4 text-primary" />
            Vision AI extraction
          </CardTitle>
          <CardDescription>
            Choose between the live extraction endpoint and the offline demo generator.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="mode">Extraction mode</Label>
              <Select
                value={settings.extractionMode}
                onValueChange={(value) =>
                  updateSettings({ extractionMode: value as "demo" | "live" })
                }
              >
                <SelectTrigger id="mode" className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="demo">Demo generator (offline)</SelectItem>
                  <SelectItem value="live">Live endpoint (Claude 3.5 / GPT-4o Vision)</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {settings.extractionMode === "live"
                  ? "Page images are POSTed to /api/extract. Failures fall back to the demo generator."
                  : "Deterministic sample data — no API credentials required."}
              </p>
            </div>
            <div>
              <Label htmlFor="api-base">API base URL</Label>
              <Input
                id="api-base"
                className="mt-1.5 font-mono text-xs"
                value={settings.apiBaseUrl}
                onChange={(event) => updateSettings({ apiBaseUrl: event.target.value })}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Expects <span className="font-mono">POST /api/extract</span> and{" "}
                <span className="font-mono">GET /api/dpd/&#123;din&#125;</span>.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-slate-950 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <Terminal className="h-3.5 w-3.5" />
              Medical system prompt sent to the vision model
            </p>
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-200">
              {EXTRACTION_SYSTEM_PROMPT}
            </pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-primary" />
            DIN & confidence rules
          </CardTitle>
          <CardDescription>
            Controls the green / amber / red colour coding across the verification workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 pt-0">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" />
            <span>
              <span className="block text-sm font-medium text-foreground">
                DPD cross-reference active
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Every 8-digit DIN is checked against the Health Canada Drug Product Database, including
                the GS1 check digit. Products without a DIN are flagged as IS_COMPOUND.
              </span>
            </span>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
              checked={settings.autoAdvance}
              onChange={(event) => updateSettings({ autoAdvance: event.target.checked })}
            />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Auto-advance after a push
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Jump straight to the next pending script once keystrokes are delivered.
              </span>
            </span>
          </label>

          <div>
            <Label htmlFor="high">High-confidence threshold</Label>
            <Input
              id="high"
              type="number"
              min={0.5}
              max={1}
              step={0.01}
              className="mt-1.5"
              value={settings.highThreshold}
              onChange={(event) => updateSettings({ highThreshold: Number(event.target.value) || 0.9 })}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">Default 0.90 — green border.</p>
          </div>
          <div>
            <Label htmlFor="medium">Medium-confidence threshold</Label>
            <Input
              id="medium"
              type="number"
              min={0.3}
              max={0.95}
              step={0.01}
              className="mt-1.5"
              value={settings.mediumThreshold}
              onChange={(event) =>
                updateSettings({ mediumThreshold: Number(event.target.value) || 0.7 })
              }
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">Default 0.70 — amber border.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <MonitorSmartphone className="h-4 w-4 text-primary" />
              Desktop helper
            </CardTitle>
            <CardDescription>
              Background executable that injects keystrokes into the Pharmacy Management System.
            </CardDescription>
          </div>
          <AgentStatusPill />
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="agent-url">Helper WebSocket endpoint</Label>
              <Input
                id="agent-url"
                className="mt-1.5 font-mono text-xs"
                value={settings.agentUrl}
                onChange={(event) => updateSettings({ agentUrl: event.target.value })}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Default <span className="font-mono">ws://localhost:{AGENT_PORT}</span> — the helper also
                serves HTTP on the same port.
              </p>
            </div>
            <div>
              <Label>Session</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Button variant="outline" onClick={reconnectAgent}>
                  <PlugZap className="h-4 w-4" />
                  Reconnect
                </Button>
                <Badge variant={agentStatus === "connected" ? "success" : "warning"}>
                  {agentStatus}
                </Badge>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <Label>Default target system</Label>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {PMS_PROFILES.map((profile) => {
                const selected = settings.pms === profile.id;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => updateSettings({ pms: profile.id as PmsId })}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-border hover:bg-secondary/60",
                    )}
                  >
                    <p className="text-sm font-semibold text-foreground">{profile.name}</p>
                    <p className="text-[11px] text-muted-foreground">{profile.vendor}</p>
                    <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                      {profile.shortcut}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Keystroke entry order · {settings.pms}
            </p>
            <ol className="mt-2 flex flex-wrap gap-2">
              {(PMS_PROFILES.find((profile) => profile.id === settings.pms)?.entryOrder ?? []).map(
                (step, index) => (
                  <li
                    key={step}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-foreground"
                  >
                    {index + 1}. {step}
                  </li>
                ),
              )}
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <RotateCcw className="h-4 w-4 text-primary" />
            Queue data
          </CardTitle>
          <CardDescription>Reset to the seeded demo batch, discarding local edits.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Button
            variant="outline"
            onClick={() => {
              resetQueue();
              toast.success("Demo queue restored");
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Reset queue to sample data
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
