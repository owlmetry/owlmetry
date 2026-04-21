"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import type { TeamAppUsersQueryParams } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamAppUsers } from "@/hooks/use-team-app-users";
import { useTeam } from "@/contexts/team-context";
import { useAppColorMap, useProjectInfoMap } from "@/hooks/use-project-colors";
import { ProjectDot } from "@/lib/project-color";
import { countryFlag } from "@/lib/country-flag";
import { getBillingBadgeState } from "@/lib/billing-badge";
import { DashboardSection } from "./dashboard-section";
import { EmptyState } from "./empty-state";
import { timeAgo } from "./time-ago";

type Mode = "active" | "new";

export function RecentUsersPanel({ mode = "active" }: { mode?: Mode } = {}) {
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id;

  const filters: TeamAppUsersQueryParams = {};
  if (teamId) filters.team_id = teamId;
  filters.limit = 5;
  if (mode === "new") filters.sort = "first_seen";

  const { users, isLoading } = useTeamAppUsers(filters);
  const appColorMap = useAppColorMap(teamId);
  const projectInfoMap = useProjectInfoMap(teamId);

  const title = mode === "new" ? "Recently Added Users" : "Recently Active Users";
  const emptyTitle = mode === "new" ? "No new users" : "No recent users";
  const sortParam = mode === "new" ? "first_seen" : "last_seen";
  const viewAllHref = `/dashboard/users?sort=${sortParam}`;

  return (
    <DashboardSection eyebrow="People" title={title} viewAllHref={viewAllHref}>
      {isLoading ? (
        <SkeletonRows />
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title={emptyTitle}
          subtitle="Users will appear here after events are ingested."
        />
      ) : (
        users.slice(0, 5).map((user) => {
          const firstApp = user.apps?.[0];
          const extraApps = Math.max(0, (user.apps?.length ?? 0) - 1);
          const project = !firstApp ? projectInfoMap.get(user.project_id) : null;
          const badge = getBillingBadgeState(user.properties);
          const flag = countryFlag(user.last_country_code);
          return (
            <Link
              key={user.id}
              href={`/dashboard/users?app_user_id=${user.id}&sort=${sortParam}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="shrink-0 w-[68px] flex justify-start">
                {user.is_anonymous ? (
                  <Badge variant="secondary" className="text-[10px] h-5">👻 anon</Badge>
                ) : (
                  <Badge variant="default" className="text-[10px] h-5">👤 real</Badge>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs truncate">{user.user_id}</p>
                {firstApp ? (
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground min-w-0">
                    <span className="flex items-center gap-1 min-w-0">
                      <ProjectDot color={appColorMap.get(firstApp.app_id)} size={6} />
                      <span className="truncate">{firstApp.app_name}</span>
                    </span>
                    {extraApps > 0 && <span>· +{extraApps} more</span>}
                  </div>
                ) : project ? (
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground min-w-0">
                    <span className="flex items-center gap-1 min-w-0">
                      <ProjectDot color={project.color} size={6} />
                      <span className="truncate">{project.name}</span>
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {badge.primaryTooltip && (badge.isCancelledTrial || badge.isTrial || badge.isPaid) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        {badge.isCancelledTrial && (
                          <Badge variant="default" className="text-[10px] h-5 bg-red-600">🎁 Trial</Badge>
                        )}
                        {badge.isTrial && (
                          <Badge variant="default" className="text-[10px] h-5 bg-sky-600">🎁 Trial</Badge>
                        )}
                        {badge.isPaid && (
                          <Badge variant="default" className="text-[10px] h-5 bg-green-600">💰 Paid</Badge>
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{badge.primaryTooltip}</TooltipContent>
                  </Tooltip>
                )}
                {badge.cancelledTooltip && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary" className="text-[10px] h-5">Cancelled</Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{badge.cancelledTooltip}</TooltipContent>
                  </Tooltip>
                )}
              </div>
              {flag.emoji && (
                <span
                  className="text-xs shrink-0"
                  title={`${flag.name} (${flag.code})`}
                >
                  {flag.emoji}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                {timeAgo(mode === "new" ? user.first_seen_at : user.last_seen_at)}
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
          <Skeleton className="h-5 w-16" />
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
