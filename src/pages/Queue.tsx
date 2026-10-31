import * as React from "react";
import { Filter, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ManualEntryDialog } from "@/components/ManualEntryDialog";
import { QueueTable } from "@/components/QueueTable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { scriptIssues } from "@/lib/confidence";
import { useAppStore } from "@/store/app-store";

type QueueFilter = "all" | "pending" | "verified" | "pushed" | "flagged";

const FILTERS: Array<{ id: QueueFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "verified", label: "Verified" },
  { id: "pushed", label: "Pushed" },
  { id: "flagged", label: "Flagged" },
];

export default function Queue() {
  const { scripts } = useAppStore();
  const navigate = useNavigate();
  const [filter, setFilter] = React.useState<QueueFilter>("all");
  const [query, setQuery] = React.useState("");

  const filtered = scripts.filter((script) => {
    if (filter === "pending" && script.status !== "pending") return false;
    if (filter === "verified" && script.status !== "verified") return false;
    if (filter === "pushed" && script.status !== "pushed") return false;
    if (filter === "flagged" && !scriptIssues(script).length) return false;

    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return (
      script.patient.full_name.toLowerCase().includes(needle) ||
      script.prescriber.name.toLowerCase().includes(needle) ||
      script.documentName.toLowerCase().includes(needle) ||
      script.medications.some(
        (medication) =>
          medication.drug_name.toLowerCase().includes(needle) || medication.din.includes(needle),
      )
    );
  });

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 p-4 lg:p-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-sm">
              {filtered.length} prescription{filtered.length === 1 ? "" : "s"}
            </CardTitle>
            <CardDescription>Every script captured by the Vision AI intake pipeline</CardDescription>
          </div>
          <ManualEntryDialog />
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={filter} onValueChange={(value) => setFilter(value as QueueFilter)}>
              <TabsList>
                {FILTERS.map((item) => (
                  <TabsTrigger key={item.id} value={item.id}>
                    <Filter className="h-3 w-3" />
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search patient, drug or DIN"
                className="pl-8"
              />
            </div>
          </div>

          <QueueTable scripts={filtered} onOpen={(id) => navigate(`/verify/${id}`)} />
        </CardContent>
      </Card>
    </div>
  );
}
