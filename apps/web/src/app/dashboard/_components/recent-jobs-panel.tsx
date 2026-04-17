"use client";

import Link from "next/link";
import { Cog } from "lucide-react";
import type { JobRunsQueryParams, JobType } from "@owlmetry/shared";
import { JOB_TYPE_META } from "@owlmetry/shared/jobs";
import { formatDuration as formatMs } from "@owlmetry/shared/constants";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobRuns } from "@/hooks/use-jobs";
import { useTeam } from "@/contexts/team-context";
import { DashboardSection } from "./dashboard-section";
import { EmptyState } from "./empty-state";
import { timeAgo } from "./time-ago";

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="default" className="bg-green-600 text-[10px] h-5">completed</Badge>;
    case "failed":
      return <Badge variant="destructive" className="text-[10px] h-5">failed</Badge>;
    case "running":
      return <Badge variant="default" className="bg-blue-600 text-[10px] h-5 animate-pulse">running</Badge>;
    case "cancelled":
      return <Badge variant="secondary" className="text-[10px] h-5">cancelled</Badge>;
    case "pending":
      return <Badge variant="outline" className="text-[10px] h-5">pending</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px] h-5">{status}</Badge>;
  }
}

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
          return (
            <Link
              key={run.id}
              href="/dashboard/jobs"
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="shrink-0 w-[88px] flex justify-start">
                {statusBadge(run.status)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{label}</p>
                {duration && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                    {duration}
                  </div>
                )}
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
