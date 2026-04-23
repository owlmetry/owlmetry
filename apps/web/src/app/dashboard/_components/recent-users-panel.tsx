"use client";

import Link from "next/link";
import { useMemo } from "react";
import useSWR from "swr";
import { Users } from "lucide-react";
import type { AppResponse, TeamAppUsersQueryParams } from "@owlmetry/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamAppUsers } from "@/hooks/use-team-app-users";
import { useTeam } from "@/contexts/team-context";
import { useAppColorMap, useProjectInfoMap } from "@/hooks/use-project-colors";
import { ProjectDot } from "@/lib/project-color";
import { CountryEmoji } from "@/components/country-flag";
import { AttributionBadge } from "@/components/attribution-badge";
import { BillingBadge } from "@/components/billing-badge";
import { UserTypeBadge } from "@/components/badges/user-type-badge";
import { VersionBadge, pickLatestForUser } from "@/components/version-badge";
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
  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    teamId ? `/v1/apps?team_id=${teamId}` : null,
  );
  const appLatestVersionMap = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of appsData?.apps ?? []) m.set(a.id, a.latest_app_version ?? null);
    return m;
  }, [appsData]);

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
          return (
            <Link
              key={user.id}
              href={`/dashboard/users?app_user_id=${user.id}&sort=${sortParam}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="shrink-0 w-[68px] flex justify-start">
                <UserTypeBadge isAnonymous={user.is_anonymous} />
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
                <BillingBadge properties={user.properties} size="sm" />
                <AttributionBadge properties={user.properties} size="sm" />
                <VersionBadge
                  version={user.last_app_version}
                  latestVersion={pickLatestForUser(user.apps ?? [], appLatestVersionMap)}
                />
              </div>
              <CountryEmoji code={user.last_country_code} />
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
