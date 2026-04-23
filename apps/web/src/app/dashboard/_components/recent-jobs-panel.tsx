"use client";

import { useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Cog } from "lucide-react";
import type { JobRunsQueryParams, JobType, ProjectResponse } from "@owlmetry/shared";
import { JOB_TYPE_META } from "@owlmetry/shared/jobs";
import { formatDuration as formatMs } from "@owlmetry/shared/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobRuns } from "@/hooks/use-jobs";
import { useTeam } from "@/contexts/team-context";
import { ProjectDot } from "@/lib/project-color";
import { JobStatusBadge } from "@/components/badges/job-status-badge";
import { DashboardSection } from "./dashboard-section";
import { EmptyState } from "./empty-state";
import { timeAgo } from "./time-ago";

function durationOf(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  return formatMs(end - start);
}

export function RecentJobsPanel() {
  const { currentTeam, currentRole } = useTeam();
  const teamId = currentTeam?.id;

  const filters: Partial<JobRunsQueryParams> = { limit: "5" };
  const isAdmin = currentRole === "owner" || currentRole === "admin";
  const { jobRuns, isLoading } = useJobRuns(isAdmin ? teamId : undefined, filters);

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    isAdmin && teamId ? `/v1/projects?team_id=${teamId}` : null
  );
  const projectById = useMemo(() => {
    const map = new Map<string, ProjectResponse>();
    for (const p of projectsData?.projects ?? []) map.set(p.id, p);
    return map;
  }, [projectsData]);

  if (!isAdmin) return null;

  return (
    <DashboardSection eyebrow="Work" title="Recent Jobs" viewAllHref="/dashboard/jobs">
      {isLoading ? (
        <SkeletonRows />
      ) : jobRuns.length === 0 ? (
        <EmptyState
          icon={Cog}
          title="No recent jobs"
          subtitle="Background jobs will appear here when they run."
        />
      ) : (
        jobRuns.slice(0, 5).map((run) => {
          const label = JOB_TYPE_META[run.job_type as JobType]?.label ?? run.job_type;
          const duration = durationOf(run.started_at, run.completed_at);
          const project = run.project_id ? projectById.get(run.project_id) : null;
          return (
            <Link
              key={run.id}
              href={`/dashboard/jobs?job_id=${run.id}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="shrink-0 w-[88px] flex justify-start">
                <JobStatusBadge status={run.status} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{label}</p>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  {project && (
                    <span className="flex items-center gap-1 min-w-0">
                      <ProjectDot color={project.color} size={6} />
                      <span className="truncate">{project.name}</span>
                    </span>
                  )}
                  {duration && <span className="font-mono">{duration}</span>}
                </div>
              </div>
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                {timeAgo(run.created_at)}
              </span>
            </Link>
          );
        })
      )}
    </DashboardSection>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Skeleton className="h-5 w-20" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </>
  );
}
