import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_THRESHOLDS, LEVEL_STYLES, levelForScore } from "@/lib/confidence";
import { useAppStore } from "@/store/app-store";

export function ConfidenceChart() {
  const { scripts } = useAppStore();

  const buckets = [
    { key: "high", label: "High", count: 0 },
    { key: "medium", label: "Medium", count: 0 },
    { key: "low", label: "Low", count: 0 },
  ];

  scripts.forEach((script) => {
    const level = levelForScore(script.overallConfidence, DEFAULT_THRESHOLDS);
    const bucket = buckets.find((candidate) => candidate.key === level);
    if (bucket) bucket.count += 1;
  });

  const data = buckets.map((bucket) => ({
    label: bucket.label,
    count: bucket.count,
    fill: LEVEL_STYLES[bucket.key as "high" | "medium" | "low"].hex,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Extraction confidence mix</CardTitle>
        <CardDescription>Overall per-script confidence across the queue</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-[150px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "#64748b" }}
              />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.15)" }}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid hsl(214 32% 91%)",
                  fontSize: 12,
                }}
                formatter={(value: number) => [`${value} script(s)`, "Count"]}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={44}>
                {data.map((entry) => (
                  <Cell key={entry.label} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
