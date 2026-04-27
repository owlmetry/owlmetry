"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { Bug, CheckCircle2, Filter, FolderOpen, ScrollText, UserSearch, Waypoints, MessageSquare, Star } from "lucide-react";
import type {
  AppResponse,
  CompletionsCountResponse,
  EventsCountResponse,
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
import { RecentUsersPanel } from "./_components/recent-users-panel";
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

  const { data: eventsCountData, isLoading: eventsCountLoading } =
    useSWR<EventsCountResponse>(
      teamId
        ? `/v1/events/count?team_id=${teamId}&data_mode=${dataMode}&since=${eventsSince}`
        : null,
      { refreshInterval: 30_000 }
    );

  const { data: metricsCompletedData, isLoading: metricsCompletedLoading } =
    useSWR<CompletionsCountResponse>(
      teamId
        ? `/v1/metrics/completions/count?team_id=${teamId}&data_mode=${dataMode}&since=${eventsSince}`
        : null,
      { refreshInterval: 30_000 }
    );

  const { data: funnelsCompletedData, isLoading: funnelsCompletedLoading } =
    useSWR<CompletionsCountResponse>(
      teamId
        ? `/v1/funnels/completions/count?team_id=${teamId}&data_mode=${dataMode}&since=${eventsSince}`
        : null,
      { refreshInterval: 30_000 }
    );

  const { data: feedbackCountData, isLoading: feedbackCountLoading } =
    useSWR<{ count: number }>(
      teamId ? `/v1/feedback/count?team_id=${teamId}&status=new` : null,
      { refreshInterval: 60_000 }
    );

  const { data: reviewsCountData, isLoading: reviewsCountLoading } =
    useSWR<{ count: number }>(
      teamId ? `/v1/reviews/count?team_id=${teamId}` : null,
      { refreshInterval: 60_000 }
    );

  const projectCount = projectsData?.projects.length;
  const appCount = appsData?.apps.length;
  const openIssueCount = issuesData?.issues.filter((i) =>
    UNRESOLVED_STATUSES.has(i.status)
  ).length;
  const eventCount = eventsCountData?.count;
  const uniqueUsers = eventsCountData?.unique_users;
  const uniqueSessions = eventsCountData?.unique_sessions;
  const metricsCompleted = metricsCompletedData?.count;
  const funnelsCompleted = funnelsCompletedData?.count;
  const funnelsStarted = funnelsCompletedData?.started;
  const funnelsValue =
    funnelsCompleted === undefined || funnelsStarted === undefined
      ? undefined
      : `${funnelsCompleted}/${funnelsStarted}`;
  const funnelsPercent =
    funnelsCompleted === undefined ||
    funnelsStarted === undefined ||
    funnelsStarted === 0
      ? undefined
      : `${Math.round((funnelsCompleted / funnelsStarted) * 100)}%`;

  const projectsAppsLoading = projectsLoading || appsLoading;
  const projectsAppsValue =
    projectCount === undefined || appCount === undefined
      ? undefined
      : `${projectCount} · ${appCount}`;

  // Aggregate rating across every Apple app in the team. Average is weighted
  // by per-app rating count so a 5-star app with 1 rating doesn't outweigh
  // a 4-star app with 50,000. Apps without an iTunes Lookup result yet are
  // skipped (latest_rating null).
  const ratingSummary = useMemo(() => {
    const apps = appsData?.apps ?? [];
    let totalRatings = 0;
    let weightedSum = 0;
    for (const a of apps) {
      const rating = a.latest_rating;
      const count = a.latest_rating_count ?? 0;
      if (rating === null || rating === undefined || count <= 0) continue;
      totalRatings += count;
      weightedSum += rating * count;
    }
    if (totalRatings === 0) return { avg: undefined, total: undefined };
    return {
      avg: (weightedSum / totalRatings).toFixed(1),
      total: totalRatings,
    };
  }, [appsData]);
  const ratingValue = ratingSummary.avg !== undefined ? `★ ${ratingSummary.avg}` : "—";
  const ratingSecondary =
    ratingSummary.total !== undefined ? ratingSummary.total.toLocaleString() : undefined;

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
        />
        <StatCard
          label="Events · 24h"
          icon={ScrollText}
          value={eventCount}
          isLoading={eventsCountLoading}
          href="/dashboard/events"
        />
        <StatCard
          label="Users · 24h"
          icon={UserSearch}
          value={uniqueUsers}
          isLoading={eventsCountLoading}
          href="/dashboard/users"
        />
        <StatCard
          label="Sessions · 24h"
          icon={Waypoints}
          value={uniqueSessions}
          isLoading={eventsCountLoading}
        />
        <StatCard
          label="Metrics · 24h"
          icon={CheckCircle2}
          value={metricsCompleted}
          isLoading={metricsCompletedLoading}
          href="/dashboard/metrics"
        />
        <StatCard
          label="Funnels · 24h"
          icon={Filter}
          value={funnelsValue}
          secondary={funnelsPercent}
          isLoading={funnelsCompletedLoading}
          href="/dashboard/funnels"
        />
        <StatCard
          label="New Feedback"
          icon={MessageSquare}
          value={feedbackCountData?.count ?? 0}
          isLoading={feedbackCountLoading}
          href="/dashboard/feedback"
        />
        <StatCard
          label="Reviews"
          icon={Star}
          value={reviewsCountData?.count ?? 0}
          isLoading={reviewsCountLoading}
          href="/dashboard/reviews"
        />
        <StatCard
          label="Avg Rating · All Apps"
          icon={Star}
          value={ratingValue}
          secondary={ratingSecondary}
          isLoading={appsLoading}
          href="/dashboard/projects"
        />
        <StatCard
          label="Projects · Apps"
          icon={FolderOpen}
          value={projectsAppsValue}
          isLoading={projectsAppsLoading}
          href="/dashboard/projects"
        />
      </StatRow>

      <div className="grid gap-4 lg:grid-cols-2">
        <OpenIssuesPanel />
        <RecentEventsPanel />
        <RecentUsersPanel mode="active" />
        <RecentUsersPanel mode="new" />
        {isAdmin && <RecentJobsPanel />}
        {isAdmin && <RecentAuditPanel />}
      </div>

      <QuickLinks />
    </div>
  );
}
