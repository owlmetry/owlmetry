"use client";

import Link from "next/link";
import { Bug, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectDot } from "@/lib/project-color";
import { useIssues } from "@/hooks/use-issues";
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import type { IssueStatus } from "@owlmetry/shared";
import { DashboardSection } from "./dashboard-section";
import { EmptyState } from "./empty-state";
import { timeAgo } from "./time-ago";

const UNRESOLVED: IssueStatus[] = ["new", "in_progress", "regressed"];

const STATUS_EMOJI: Record<IssueStatus, string> = {
  new: "🆕",
  in_progress: "🔧",
  regressed: "🔄",
  resolved: "✅",
  silenced: "🔇",
};

export function OpenIssuesPanel() {
  const { currentTeam } = useTeam();
  const { dataMode } = useDataMode();
  const teamId = currentTeam?.id;

  const { issues, isLoading } = useIssues({
    team_id: teamId,
    data_mode: dataMode,
    limit: "50",
  });

  const unresolved = issues
    .filter((i) => UNRESOLVED.includes(i.status))
    .sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime())
    .slice(0, 5);

  return (
    <DashboardSection eyebrow="Triage" title="Open Issues" viewAllHref="/dashboard/issues">
      {isLoading ? (
        <SkeletonRows />
      ) : unresolved.length === 0 ? (
        <EmptyState
          icon={Bug}
          title="No open issues 🎉"
          subtitle="Everything's looking good."
        />
      ) : (
        unresolved.map((issue) => (
          <Link
            key={issue.id}
            href={`/dashboard/issues?project_id=${issue.project_id}&issue_id=${issue.id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm leading-none">
              {STATUS_EMOJI[issue.status]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-tight truncate">
                {issue.title}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                {issue.app_name && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 px-1.5 flex items-center gap-1 shrink-0"
                  >
                    <ProjectDot projectId={issue.project_id} size={5} />
                    <span className="max-w-[90px] truncate">{issue.app_name}</span>
                  </Badge>
                )}
                <span className="flex items-center gap-1">
                  <Bug className="h-3 w-3" />
                  {issue.occurrence_count}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {issue.unique_user_count}
                </span>
              </div>
            </div>
            <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
              {timeAgo(issue.last_seen_at)}
            </span>
          </Link>
        ))
      )}
    </DashboardSection>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-5 w-5 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </>
  );
}
