"use client";

const BAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-pink-500",
];

interface BreakdownChartProps {
  title: string;
  data: Array<{ label: string; count: number }>;
  total: number;
}

export function BreakdownChart({ title, data, total }: BreakdownChartProps) {
  const items = data.slice(0, 8);
  if (items.length === 0) return null;
  const maxCount = Math.max(...items.map((d) => d.count));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="space-y-2">
        {items.map((item, i) => {
          const pct = total > 0 ? (item.count / total) * 100 : 0;
          const barWidth = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
          return (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate max-w-[60%]">{item.label || "(empty)"}</span>
                <span className="text-muted-foreground">
                  {item.count} ({pct.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
