"use client";

import type {
  MetricDefinitionResponse,
  MetricStatsEntry,
  TeamMetricStatsEntry,
} from "@owlmetry/shared";
import { ProjectDot } from "@/lib/project-color";
import { MetricCardGrid } from "./metric-card-grid";

export interface ProjectMetricsBucket {
  projectId: string;
  items: MetricDefinitionResponse[];
  totalCompletions: number;
}

/**
 * Group metrics by project_id, sum completion counts per bucket via the
 * supplied stats map, then sort: most completions first, then by project name
 * (resolved via the caller's lookup) for stable tiebreaks.
 */
export function bucketByProject(
  metrics: MetricDefinitionResponse[],
  statsByProjectSlug: Map<string, TeamMetricStatsEntry>,
  resolveProjectName: (projectId: string) => string,
): ProjectMetricsBucket[] {
  const map = new Map<string, ProjectMetricsBucket>();
  for (const m of metrics) {
    let bucket = map.get(m.project_id);
    if (!bucket) {
      bucket = { projectId: m.project_id, items: [], totalCompletions: 0 };
      map.set(m.project_id, bucket);
    }
    bucket.items.push(m);
    const stats = statsByProjectSlug.get(`${m.project_id}:${m.slug}`);
    if (stats) bucket.totalCompletions += stats.complete_count;
  }
  return [...map.values()].sort((a, b) => {
    if (b.totalCompletions !== a.totalCompletions) return b.totalCompletions - a.totalCompletions;
    return resolveProjectName(a.projectId).localeCompare(resolveProjectName(b.projectId));
  });
}

interface ProjectMetricsSectionProps {
  projectName: string;
  projectColor: string | null | undefined;
  bucket: ProjectMetricsBucket;
  resolveStats: (metric: MetricDefinitionResponse) => MetricStatsEntry | undefined;
  projectColors: Map<string, string>;
  startIndex: number;
}

export function ProjectMetricsSection({
  projectName,
  projectColor,
  bucket,
  resolveStats,
  projectColors,
  startIndex,
}: ProjectMetricsSectionProps) {
  const definitionLabel = `${bucket.items.length} metric${bucket.items.length === 1 ? "" : "s"}`;
  const completionLabel = `${bucket.totalCompletions.toLocaleString()} completion${bucket.totalCompletions === 1 ? "" : "s"}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <ProjectDot color={projectColor} size={10} />
          <h2 className="text-sm font-semibold truncate">{projectName}</h2>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          <span className="text-foreground font-medium">{definitionLabel}</span>
          {" · "}
          <span className="text-foreground font-medium">{completionLabel}</span>
        </div>
      </div>
      <MetricCardGrid
        metrics={bucket.items}
        resolveStats={resolveStats}
        projectColors={projectColors}
        hideProjectDot
        startIndex={startIndex}
      />
    </div>
  );
}
