"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { Bug, FolderOpen, Smartphone, ScrollText } from "lucide-react";
import type {
  AppResponse,
  EventsResponse,
  IssuesResponse,
  ProjectResponse,
} from "@owlmetry/shared";
import { useUser } from "@/hooks/use-user";
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import { formatLongDate } from "@/lib/format-date";
import { StatCard, StatRow } from "./_components/stat-card";
import { OpenIssuesPanel } from "./_components/open-issues-panel";
import { RecentEventsPanel } from "./_components/recent-events-panel";
import { RecentJobsPanel } from "./_components/recent-jobs-panel";
import { RecentAuditPanel } from "./_components/recent-audit-panel";
import { QuickLinks } from "./_components/quick-links";

const UNRESOLVED_STATUSES = new Set(["new", "in_progress", "regressed"]);

export default function DashboardPage() {
  const { user } = useUser();
  const { currentTeam, currentRole } = useTeam();
  const { dataMode } = useDataMode();
  const teamId = currentTeam?.id;
  const isAdmin = currentRole === "owner" || currentRole === "admin";

  const { data: projectsData, isLoading: projectsLoading } = useSWR<{
    projects: ProjectResponse[];
  }>(teamId ? `/v1/projects?team_id=${teamId}` : null);

  const { data: appsData, isLoading: appsLoading } = useSWR<{ apps: AppResponse[] }>(
    teamId ? `/v1/apps?team_id=${teamId}` : null
  );

  const { data: issuesData, isLoading: issuesLoading } = useSWR<IssuesResponse>(
    teamId ? `/v1/issues?team_id=${teamId}&data_mode=${dataMode}&limit=100` : null
  );

  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const eventsSince = useMemo(
    () => new Date(hourBucket * 3_600_000 - 24 * 60 * 60 * 1000).toISOString(),
    [hourBucket]
  );

  const { data: eventsData, isLoading: eventsLoading } = useSWR<EventsResponse>(
    teamId
      ? `/v1/events?team_id=${teamId}&data_mode=${dataMode}&since=${eventsSince}&limit=100`
      : null
  );

  const projectCount = projectsData?.projects.length;
  const appCount = appsData?.apps.length;
  const openIssueCount = issuesData?.issues.filter((i) =>
    UNRESOLVED_STATUSES.has(i.status)
  ).length;
  const eventCount = eventsData?.events.length;
  const eventsHasMore = eventsData?.has_more ?? false;
  const eventsDisplay =
    eventCount === undefined
      ? undefined
      : eventsHasMore
        ? `${eventCount}+`
        : `${eventCount}`;

  const today = formatLongDate(new Date());
  const firstName = user?.name?.split(" ")[0];

  return (
    <div className="space-y-8 animate-fade-in-up">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {today}
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">
            Welcome back{firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        {currentTeam && (
          <p className="text-xs text-muted-foreground">
            <span className="text-muted-foreground/60">Team ·</span>{" "}
            <span className="font-medium text-foreground">{currentTeam.name}</span>
          </p>
        )}
      </div>

      <StatRow>
        <StatCard
          label="Open Issues"
          icon={Bug}
          value={openIssueCount}
          isLoading={issuesLoading}
          href="/dashboard/issues"
          tone="alert"
        />
        <StatCard
          label="Events · 24h"
          icon={ScrollText}
          value={eventsDisplay}
          isLoading={eventsLoading}
          href="/dashboard/events"
        />
        <StatCard
          label="Projects"
          icon={FolderOpen}
          value={projectCount}
          isLoading={projectsLoading}
          href="/dashboard/projects"
        />
        <StatCard
          label="Apps"
          icon={Smartphone}
          value={appCount}
          isLoading={appsLoading}
          href="/dashboard/projects"
        />
      </StatRow>

      <div className="grid gap-4 lg:grid-cols-2">
        <OpenIssuesPanel />
        <RecentEventsPanel />
        {isAdmin && <RecentJobsPanel />}
        {isAdmin && <RecentAuditPanel />}
      </div>

      <QuickLinks />
    </div>
  );
}
