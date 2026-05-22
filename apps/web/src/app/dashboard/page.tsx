"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Bug, CheckCircle2, ClipboardList, Filter, ScrollText, UserSearch, Waypoints, MessageSquare, Star } from "lucide-react";
import type {
  AppResponse,
  CompletionsCountResponse,
  EventsCountResponse,
  IssuesResponse,
  ProjectResponse,
} from "@owlmetry/shared";
import { useUser } from "@/hooks/use-user";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { useDailyStats } from "@/hooks/use-daily-stats";
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import { formatLongDate } from "@/lib/format-date";
import { computeRatingSummary } from "@/lib/rating-summary";
import { resolveSparklineWindowDays } from "@owlmetry/shared/preferences";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectDot } from "@/lib/project-color";
import { StatCard, StatRow } from "./_components/stat-card";
import { OpenIssuesPanel } from "./_components/open-issues-panel";
import { RecentEventsPanel } from "./_components/recent-events-panel";
import { RecentJobsPanel } from "./_components/recent-jobs-panel";
import { RecentAuditPanel } from "./_components/recent-audit-panel";
import { RecentUsersPanel } from "./_components/recent-users-panel";
import { QuickLinks } from "./_components/quick-links";

const UNRESOLVED_STATUSES = new Set(["new", "in_progress", "regressed"]);
const ALL_PROJECTS = "__all__";

export default function DashboardPage() {
  const { user } = useUser();
  const prefs = useUserPreferences();
  const { currentTeam, currentRole } = useTeam();
  const { dataMode } = useDataMode();
  const teamId = currentTeam?.id;
  const isAdmin = currentRole === "owner" || currentRole === "admin";
  const sparklineDays = resolveSparklineWindowDays(prefs);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [projectId, setProjectIdState] = useState(
    searchParams.get("project_id") ?? ALL_PROJECTS,
  );
  const selectedProjectId = projectId !== ALL_PROJECTS ? projectId : "";
  const projectQs = selectedProjectId ? `&project_id=${selectedProjectId}` : "";

  function setProjectId(id: string) {
    setProjectIdState(id);
    const params = new URLSearchParams();
    if (id !== ALL_PROJECTS) params.set("project_id", id);
    const qs = params.toString();
    router.replace(`/dashboard${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null,
  );
  const projects = projectsData?.projects ?? [];
  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : null;

  const { data: appsData, isLoading: appsLoading } = useSWR<{ apps: AppResponse[] }>(
    teamId ? `/v1/apps?team_id=${teamId}` : null
  );

  const { data: issuesData, isLoading: issuesLoading } = useSWR<IssuesResponse>(
    teamId ? `/v1/issues?team_id=${teamId}&data_mode=${dataMode}&limit=100${projectQs}` : null
  );

  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const eventsSince = useMemo(
    () => new Date(hourBucket * 3_600_000 - 24 * 60 * 60 * 1000).toISOString(),
    [hourBucket]
  );

  const { data: eventsCountData, isLoading: eventsCountLoading } =
    useSWR<EventsCountResponse>(
      teamId
        ? `/v1/events/count?team_id=${teamId}&data_mode=${dataMode}&since=${eventsSince}${projectQs}`
        : null,
      { refreshInterval: 30_000 }
    );

  const { data: metricsCompletedData, isLoading: metricsCompletedLoading } =
    useSWR<CompletionsCountResponse>(
      teamId
        ? `/v1/metrics/completions/count?team_id=${teamId}&data_mode=${dataMode}&since=${eventsSince}${projectQs}`
        : null,
      { refreshInterval: 30_000 }
    );

  const { data: funnelsCompletedData, isLoading: funnelsCompletedLoading } =
    useSWR<CompletionsCountResponse>(
      teamId
        ? `/v1/funnels/completions/count?team_id=${teamId}&data_mode=${dataMode}&since=${eventsSince}${projectQs}`
        : null,
      { refreshInterval: 30_000 }
    );

  const { data: feedbackCountData, isLoading: feedbackCountLoading } =
    useSWR<{ count: number }>(
      teamId
        ? `/v1/feedback/count?team_id=${teamId}&status=new&data_mode=${dataMode}${projectQs}`
        : null,
      { refreshInterval: 60_000 }
    );

  const { data: questionnaireCountData, isLoading: questionnaireCountLoading } =
    useSWR<{ count: number }>(
      teamId
        ? `/v1/questionnaires/count?team_id=${teamId}&data_mode=${dataMode}&since=${eventsSince}${projectQs}`
        : null,
      { refreshInterval: 60_000 }
    );

  const { data: reviewsCountData, isLoading: reviewsCountLoading } =
    useSWR<{ count: number }>(
      teamId ? `/v1/reviews/count?team_id=${teamId}${projectQs}` : null,
      { refreshInterval: 60_000 }
    );

  const { data: reviewsDeltaData } = useSWR<{ count: number }>(
    teamId
      ? `/v1/reviews/count?team_id=${teamId}&since=${eventsSince}${projectQs}`
      : null,
    { refreshInterval: 60_000 }
  );

  // Sparkline series for the 6 trendable cards. All requests share the same
  // window + data mode so the lines move in lockstep with the magnitude
  // numbers above them. `excluding_current` defaults true server-side, so the
  // current UTC day is dropped automatically and a partial in-progress day
  // can't render as a dip.
  const sparkProjectId = selectedProjectId || undefined;
  const eventsSpark = useDailyStats({
    kind: "events",
    teamId,
    projectId: sparkProjectId,
    days: sparklineDays,
    dataMode,
    skip: !teamId,
  });
  const usersSpark = useDailyStats({
    kind: "users",
    teamId,
    projectId: sparkProjectId,
    days: sparklineDays,
    dataMode,
    skip: !teamId,
  });
  const sessionsSpark = useDailyStats({
    kind: "sessions",
    teamId,
    projectId: sparkProjectId,
    days: sparklineDays,
    dataMode,
    skip: !teamId,
  });
  const metricsSpark = useDailyStats({
    kind: "metric_completions",
    teamId,
    projectId: sparkProjectId,
    days: sparklineDays,
    dataMode,
    skip: !teamId,
  });
  const funnelsSpark = useDailyStats({
    kind: "funnel_completions",
    teamId,
    projectId: sparkProjectId,
    days: sparklineDays,
    dataMode,
    skip: !teamId,
  });
  const responsesSpark = useDailyStats({
    kind: "questionnaire_responses",
    teamId,
    projectId: sparkProjectId,
    days: sparklineDays,
    dataMode,
    skip: !teamId,
  });

  const openIssueCount = issuesData?.issues.filter((i) =>
    UNRESOLVED_STATUSES.has(i.status)
  ).length;
  const eventCount = eventsCountData?.count;
  const uniqueUsers = eventsCountData?.unique_users;
  const uniqueSessions = eventsCountData?.unique_sessions;
  const metricsCompleted = metricsCompletedData?.count;
  const metricsFailed = metricsCompletedData?.failed;
  const metricsTotal =
    metricsCompleted === undefined
      ? undefined
      : metricsCompleted + (metricsFailed ?? 0);
  const metricsValue =
    metricsCompleted === undefined || metricsTotal === undefined
      ? undefined
      : `${metricsCompleted}/${metricsTotal}`;
  const metricsPercent =
    metricsCompleted === undefined || metricsTotal === undefined || metricsTotal === 0
      ? undefined
      : `${Math.round((metricsCompleted / metricsTotal) * 100)}%`;
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

  // Aggregate rating across every Apple app in the team (or just the selected
  // project's apps when the picker narrows). Worldwide cache on each app is
  // itself a weighted aggregate across storefronts (recomputed daily by
  // app_store_ratings_sync). Weight again here by per-app rating count so a
  // 5-star app with 1 rating doesn't outweigh a 4-star app with 50,000.
  // Apps without a synced rating yet are skipped.
  const ratingSummary = useMemo(() => {
    const apps = appsData?.apps ?? [];
    const scoped = selectedProjectId
      ? apps.filter((a) => a.project_id === selectedProjectId)
      : apps;
    return computeRatingSummary(scoped);
  }, [appsData, selectedProjectId]);
  const ratingValue = ratingSummary ? `★ ${ratingSummary.avg.toFixed(2)}` : "—";
  const ratingSecondary = ratingSummary ? ratingSummary.total.toLocaleString() : undefined;

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
        <div className="flex items-center gap-3 flex-wrap">
          {currentTeam && (
            <p className="text-xs text-muted-foreground">
              <span className="text-muted-foreground/60">Team ·</span>{" "}
              <span className="font-medium text-foreground">{currentTeam.name}</span>
              {selectedProject && (
                <>
                  <span className="text-muted-foreground/60"> · Project ·</span>{" "}
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <ProjectDot color={selectedProject.color} />
                    {selectedProject.name}
                  </span>
                </>
              )}
            </p>
          )}
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-[220px] h-8 text-xs">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-2">
                    <ProjectDot color={p.color} />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
          sparkline={{ values: eventsSpark.values, isLoading: eventsSpark.isLoading }}
        />
        <StatCard
          label="Users · 24h"
          icon={UserSearch}
          value={uniqueUsers}
          isLoading={eventsCountLoading}
          href="/dashboard/users"
          sparkline={{ values: usersSpark.values, isLoading: usersSpark.isLoading }}
        />
        <StatCard
          label="Sessions · 24h"
          icon={Waypoints}
          value={uniqueSessions}
          isLoading={eventsCountLoading}
          href="/dashboard/events"
          sparkline={{ values: sessionsSpark.values, isLoading: sessionsSpark.isLoading }}
        />
        <StatCard
          label="Metrics · 24h"
          icon={CheckCircle2}
          value={metricsValue}
          secondary={metricsPercent}
          isLoading={metricsCompletedLoading}
          href="/dashboard/metrics"
          sparkline={{ values: metricsSpark.values, isLoading: metricsSpark.isLoading }}
        />
        <StatCard
          label="Funnels · 24h"
          icon={Filter}
          value={funnelsValue}
          secondary={funnelsPercent}
          isLoading={funnelsCompletedLoading}
          href="/dashboard/funnels"
          sparkline={{ values: funnelsSpark.values, isLoading: funnelsSpark.isLoading }}
        />
        <StatCard
          label="New Feedback"
          icon={MessageSquare}
          value={feedbackCountData?.count ?? 0}
          isLoading={feedbackCountLoading}
          href="/dashboard/feedback"
        />
        <StatCard
          label="Responses · 24h"
          icon={ClipboardList}
          value={questionnaireCountData?.count ?? 0}
          isLoading={questionnaireCountLoading}
          href="/dashboard/questionnaires"
          sparkline={{ values: responsesSpark.values, isLoading: responsesSpark.isLoading }}
        />
        <StatCard
          label="Reviews"
          icon={Star}
          value={reviewsCountData?.count ?? 0}
          delta={reviewsDeltaData?.count}
          isLoading={reviewsCountLoading}
          href="/dashboard/reviews"
        />
        <StatCard
          label="Avg Rating · All Apps"
          icon={Star}
          value={ratingValue}
          secondary={ratingSecondary}
          delta={ratingSummary?.delta}
          isLoading={appsLoading}
          href="/dashboard/reviews"
        />
      </StatRow>

      <div className="grid gap-4 lg:grid-cols-2">
        <OpenIssuesPanel projectId={sparkProjectId} />
        <RecentEventsPanel projectId={sparkProjectId} />
        <RecentUsersPanel mode="active" projectId={sparkProjectId} />
        <RecentUsersPanel mode="new" projectId={sparkProjectId} />
        {isAdmin && <RecentJobsPanel projectId={sparkProjectId} />}
        {isAdmin && <RecentAuditPanel />}
      </div>

      <QuickLinks />
    </div>
  );
}
