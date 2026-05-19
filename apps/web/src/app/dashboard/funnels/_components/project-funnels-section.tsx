"use client";

import type { FunnelDefinitionResponse } from "@owlmetry/shared";
import { ProjectDot } from "@/lib/project-color";
import { FunnelCardGrid } from "./funnel-card-grid";

export interface ProjectFunnelsBucket {
  projectId: string;
  items: FunnelDefinitionResponse[];
}

/**
 * Group funnels by project_id, then sort: most funnels first, then by project
 * name. No per-funnel rollup analog to questionnaire response counts, so the
 * primary sort key is bucket size.
 */
export function bucketByProject(
  funnels: FunnelDefinitionResponse[],
  resolveProjectName: (projectId: string) => string,
): ProjectFunnelsBucket[] {
  const map = new Map<string, ProjectFunnelsBucket>();
  for (const f of funnels) {
    let bucket = map.get(f.project_id);
    if (!bucket) {
      bucket = { projectId: f.project_id, items: [] };
      map.set(f.project_id, bucket);
    }
    bucket.items.push(f);
  }
  return [...map.values()].sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return resolveProjectName(a.projectId).localeCompare(resolveProjectName(b.projectId));
  });
}

interface ProjectFunnelsSectionProps {
  projectName: string;
  projectColor: string | null | undefined;
  bucket: ProjectFunnelsBucket;
  projectColors: Map<string, string>;
  startIndex: number;
}

export function ProjectFunnelsSection({
  projectName,
  projectColor,
  bucket,
  projectColors,
  startIndex,
}: ProjectFunnelsSectionProps) {
  const label = `${bucket.items.length} funnel${bucket.items.length === 1 ? "" : "s"}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <ProjectDot color={projectColor} size={10} />
          <h2 className="text-sm font-semibold truncate">{projectName}</h2>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          <span className="text-foreground font-medium">{label}</span>
        </div>
      </div>
      <FunnelCardGrid
        funnels={bucket.items}
        projectColors={projectColors}
        hideProjectDot
        startIndex={startIndex}
      />
    </div>
  );
}
