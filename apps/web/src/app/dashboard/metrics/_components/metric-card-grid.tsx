"use client";

import Link from "next/link";
import type { MetricDefinitionResponse, MetricStatsEntry } from "@owlmetry/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectDot } from "@/lib/project-color";
import { StaggerItem } from "@/components/ui/animated-page";

interface MetricCardGridProps {
  metrics: MetricDefinitionResponse[];
  /**
   * Look up stats for a metric by passing it to this resolver. Single-project
   * view keys by slug; all-projects view keys by `${project_id}:${slug}` to
   * keep cross-project slug collisions apart.
   */
  resolveStats: (metric: MetricDefinitionResponse) => MetricStatsEntry | undefined;
  projectColors: Map<string, string>;
  /**
   * When true, the per-card project dot is hidden (the parent already shows
   * project identity in its section header). Single-project view keeps it on.
   */
  hideProjectDot?: boolean;
  startIndex?: number;
}

export function MetricCardGrid({
  metrics,
  resolveStats,
  projectColors,
  hideProjectDot = false,
  startIndex = 0,
}: MetricCardGridProps) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map((m, idx) => {
        const stats = resolveStats(m);
        const total = stats ? stats.complete_count + stats.fail_count : 0;
        const pct =
          stats && total > 0
            ? Math.round((stats.complete_count / total) * 100)
            : null;
        return (
          <StaggerItem key={m.id} index={startIndex + idx}>
            <Link href={`/dashboard/metrics/${m.id}`}>
              <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 min-w-0">
                    {!hideProjectDot && (
                      <ProjectDot color={projectColors.get(m.project_id) ?? "#6366f1"} />
                    )}
                    <span className="truncate">{m.name}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground font-mono">{m.slug}</p>
                  {m.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.description}</p>
                  )}
                  {stats && total > 0 && (
                    <p className="text-sm font-semibold tabular-nums mt-2">
                      {stats.complete_count}/{total}
                      <span className="ml-1.5 text-xs font-medium text-muted-foreground">
                        {pct}%
                      </span>
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          </StaggerItem>
        );
      })}
    </div>
  );
}
