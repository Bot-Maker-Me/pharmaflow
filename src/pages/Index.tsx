import {
  Activity,
  BadgeCheck,
  Clock3,
  FileStack,
  Gauge,
  Radio,
  Send,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ConfidenceChart } from "@/components/ConfidenceChart";
import { ConfidenceLegend } from "@/components/Confidence";
import { HelperStatus } from "@/components/HelperStatus";
import { ManualEntryDialog } from "@/components/ManualEntryDialog";
import { QueueTable } from "@/components/QueueTable";
import { StatCard } from "@/components/StatCard";
import { UploadDropzone } from "@/components/UploadDropzone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { getPmsProfile } from "@/lib/pms";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

export default function Index() {
  const {
    documents,
    scripts,
    stats,
    pipeline,
    activity,
    settings,
    helperStatus,
    helperInfo,
    ingestFiles,
    loadSampleFax,
  } = useAppStore();
  const navigate = useNavigate();
  const pending = scripts.filter((script) => script.status === "pending").slice(0, 6);
  const profile = getPmsProfile(settings.pms);

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 p-4 lg:p-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FileStack}
          label="In intake queue"
          value={stats.pending}
          hint={`${documents.length} document(s) ingested`}
          tone="info"
        />
        <StatCard
          icon={BadgeCheck}
          label="Verified"
          value={stats.verified}
          hint="Ready for keystroke push"
          tone="success"
        />
        <StatCard
          icon={Send}
          label="Pushed to PMS"
          value={stats.pushed}
          hint={profile.name}
        />
        <StatCard
          icon={ShieldAlert}
          label="Needs a look"
          value={stats.flagged}
          hint="DIN, compound or licence checks"
          tone="warning"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <UploadDropzone onFiles={ingestFiles} onLoadSample={loadSampleFax} busy={pipeline.active} />

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
              <div>
                <CardTitle className="text-sm">Processing pipeline</CardTitle>
                <CardDescription>
                  {pipeline.active ? pipeline.stage : "Idle — watching the intake queue"}
                </CardDescription>
              </div>
              <Badge variant={pipeline.active ? "info" : "secondary"}>
                {pipeline.active ? `${pipeline.progress}%` : "Idle"}
              </Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <Progress value={pipeline.progress} />
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Ingest", icon: FileStack },
                  { label: "Vision AI", icon: Sparkles },
                  { label: "DIN lookup", icon: BadgeCheck },
                  { label: "Queue", icon: Clock3 },
                ].map((stage, index) => {
                  const threshold = (index + 1) * 25;
                  const done = pipeline.progress >= threshold;
                  const current = pipeline.active && pipeline.progress < threshold && pipeline.progress >= threshold - 25;
                  return (
                    <div
                      key={stage.label}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                        done
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : current
                            ? "border-sky-200 bg-sky-50 text-sky-700"
                            : "border-border bg-secondary/50 text-muted-foreground",
                      )}
                    >
                      <stage.icon className="h-3.5 w-3.5" />
                      {stage.label}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4 pb-3">
              <div>
                <CardTitle className="text-sm">Awaiting verification</CardTitle>
                <CardDescription>Newest extractions first</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <ManualEntryDialog />
                <Button variant="outline" onClick={() => navigate("/queue")}>
                  Open queue
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <QueueTable scripts={pending} onOpen={(id) => navigate(`/verify/${id}`)} compact />
            </CardContent>
          </Card>

          <ConfidenceChart />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Radio className="h-4 w-4 text-primary" />
                Desktop helper
              </CardTitle>
              <CardDescription>Keystroke automation bridge</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <HelperStatus />
              <div className="rounded-lg border border-border bg-secondary/50 p-3 text-xs">
                <p className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Endpoint</span>
                  <span className="font-mono text-foreground">{settings.helperUrl}</span>
                </p>
                <Separator className="my-2" />
                <p className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">target_system</span>
                  <span className="font-mono text-foreground">{profile.targetSystem}</span>
                </p>
                <Separator className="my-2" />
                <p className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Hotkey</span>
                  <span className="font-mono text-foreground">{profile.shortcut}</span>
                </p>
                {helperInfo.version ? (
                  <>
                    <Separator className="my-2" />
                    <p className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Helper build</span>
                      <span className="font-mono text-foreground">v{helperInfo.version}</span>
                    </p>
                  </>
                ) : null}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {helperStatus === "connected"
                  ? "The helper is listening — pushes POST to /autofill and are typed straight into the PMS window."
                  : "Run helper/kroll_tray_helper.py (or the packaged .exe) on the workstation to enable keystroke injection. Until then, pushes run in simulation mode."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Gauge className="h-4 w-4 text-primary" />
                Confidence thresholds
              </CardTitle>
              <CardDescription>Colour coding used across the queue</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ConfidenceLegend />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4 text-primary" />
                Recent activity
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="space-y-2.5">
                {activity.slice(0, 6).map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        entry.tone === "ok"
                          ? "bg-emerald-500"
                          : entry.tone === "warn"
                            ? "bg-amber-500"
                            : "bg-slate-400",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-xs text-foreground">{entry.text}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(entry.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
