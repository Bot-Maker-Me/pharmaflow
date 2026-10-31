import { Bot, Code2, MonitorSmartphone, PlugZap, RotateCcw, ShieldCheck, Terminal } from "lucide-react";
import { toast } from "sonner";

import { HelperStatus } from "@/components/HelperStatus";
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
import { buildHelperPayloads } from "@/lib/payload";
import { SIG_GLOSSARY } from "@/lib/sig";
import { EXTRACTION_SYSTEM_PROMPT } from "@/services/vision";
import { HELPER_PORT } from "@/services/agent";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type { PmsId } from "@/lib/types";

export default function Settings() {
  const { settings, updateSettings, checkHelper, resetQueue, helperStatus, helperInfo, scripts } =
    useAppStore();

  const samplePayload = scripts.length
    ? buildHelperPayloads(scripts[0], settings.pms)[0]
    : {
        target_system: "KROLL",
        data: {
          patient_lookup: "1234-567-890-ON",
          prescriber_license: "CPSO-78901",
          din_code: "00628115",
          quantity: "30",
          sig_text: "1 CAP PO TID X 10D",
        },
      };

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 p-4 lg:p-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <MonitorSmartphone className="h-4 w-4 text-primary" />
              Local desktop helper
            </CardTitle>
            <CardDescription>
              Flask process on the pharmacy workstation that replays prescriptions as keystrokes.
            </CardDescription>
          </div>
          <HelperStatus />
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="helper-url">Helper base URL</Label>
              <Input
                id="helper-url"
                className="mt-1.5 font-mono text-xs"
                value={settings.helperUrl}
                onChange={(event) => updateSettings({ helperUrl: event.target.value })}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Default <span className="font-mono">http://localhost:{HELPER_PORT}</span>. The helper binds
                to 127.0.0.1 only — it is never exposed to the LAN.
              </p>
            </div>
            <div>
              <Label>Connection probe</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Button variant="outline" onClick={checkHelper}>
                  <PlugZap className="h-4 w-4" />
                  Re-check /health
                </Button>
                <Badge variant={helperStatus === "connected" ? "success" : helperStatus === "offline" ? "destructive" : "warning"}>
                  {helperStatus}
                </Badge>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                The header indicator re-probes every 10 seconds.
                {helperInfo.version ? ` Detected helper v${helperInfo.version}.` : ""}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Install on the workstation
            </p>
            <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>
                1. Copy <span className="font-mono text-foreground">helper/</span> to the pharmacy PC and run{" "}
                <span className="font-mono text-foreground">pip install -r requirements.txt</span>.
              </li>
              <li>
                2. Start it with <span className="font-mono text-foreground">python kroll_tray_helper.py</span>.
              </li>
              <li>
                3. Package a single executable with{" "}
                <span className="font-mono text-foreground">pyinstaller --onefile --noconsole</span> and add
                it to the login Run key.
              </li>
            </ol>
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
                      target_system: {profile.targetSystem}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">{profile.shortcut}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {PMS_PROFILES.map((profile) => (
              <div key={profile.id} className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold text-foreground">{profile.shortName}</p>
                <dl className="mt-2 space-y-1 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Patient</dt>
                    <dd className="font-mono text-foreground">{profile.keyMap.patient}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Prescriber</dt>
                    <dd className="font-mono text-foreground">{profile.keyMap.prescriber}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Drug</dt>
                    <dd className="font-mono text-foreground">{profile.keyMap.drug}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Code2 className="h-4 w-4 text-primary" />
            Keystroke payload contract
          </CardTitle>
          <CardDescription>
            POSTed to <span className="font-mono">{"{helperUrl}"}/autofill</span> — one request per
            medication.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <pre className="overflow-auto scrollbar-thin rounded-lg border border-border bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
            {JSON.stringify(samplePayload, null, 2)}
          </pre>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-semibold text-foreground">Sig abbreviation glossary</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                {SIG_GLOSSARY.map((entry) => (
                  <li key={entry.code} className="flex items-center gap-2">
                    <span className="font-mono text-foreground">{entry.code}</span>
                    <span className="text-muted-foreground">{entry.meaning}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border p-3 text-[11px] text-muted-foreground">
              <p className="text-xs font-semibold text-foreground">Response handling</p>
              <ul className="mt-2 space-y-1">
                <li>
                  <span className="font-mono text-foreground">200</span> success → script marked as pushed.
                </li>
                <li>
                  <span className="font-mono text-foreground">400</span> unknown target_system / missing
                  data.
                </li>
                <li>
                  <span className="font-mono text-foreground">409</span> pyautogui failsafe fired.
                </li>
                <li>
                  <span className="font-mono text-foreground">503</span> keystroke backend unavailable.
                </li>
                <li>Unreachable helper → simulated push, never a silent failure.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

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
                onValueChange={(value) => updateSettings({ extractionMode: value as "demo" | "live" })}
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
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>
              <span className="block text-sm font-medium text-foreground">DPD cross-reference active</span>
              <span className="block text-[11px] text-muted-foreground">
                Every 8-digit DIN is checked against the Health Canada Drug Product Database, including the
                GS1 check digit. Products without a DIN are flagged as IS_COMPOUND.
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
              <span className="block text-sm font-medium text-foreground">Auto-advance after a push</span>
              <span className="block text-[11px] text-muted-foreground">
                Jump straight to the next pending script once the keystroke trace is dismissed.
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
              onChange={(event) => updateSettings({ mediumThreshold: Number(event.target.value) || 0.7 })}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">Default 0.70 — amber border.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm">Appearance & data</CardTitle>
          <CardDescription>Display theme and local queue contents.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4 pt-0">
          <div>
            <Label htmlFor="theme">Interface theme</Label>
            <Select
              value={settings.theme}
              onValueChange={(value) => updateSettings({ theme: value as "light" | "dark" })}
            >
              <SelectTrigger id="theme" className="mt-1.5 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
