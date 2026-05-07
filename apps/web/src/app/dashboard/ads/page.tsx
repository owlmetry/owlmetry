"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import type { ProjectResponse, AppResponse } from "@owlmetry/shared";
import {
  ATTRIBUTION_SOURCE_VALUES,
  formatRoasLabel,
  roasTone,
  type AdsRow,
  type RoasTone,
} from "@owlmetry/shared/attribution";
import { useTeam } from "@/contexts/team-context";
import { useAdCampaigns, useAdCampaignsAcrossTeam, adsActions } from "@/hooks/use-ads";
import { useProjectInfoMap } from "@/hooks/use-project-colors";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { TableSkeleton } from "@/components/ui/skeletons";
import { Megaphone, RefreshCw } from "lucide-react";
import { formatUsd } from "@/lib/currency";
import { timeAgo } from "@/app/dashboard/_components/time-ago";
import { AdsFilterBar, ALL_PROJECTS } from "./_components/ads-filter-bar";
import { AdsRowTable } from "./_components/ads-row-table";
import { CampaignAdGroupsRow } from "./_components/expanded-rows";
import { ProjectAdsSection, bucketByProject } from "./_components/project-ads-section";

const DEFAULT_SOURCE = ATTRIBUTION_SOURCE_VALUES.appleSearchAds;

function windowDaysLabel(days: number | null): string {
  if (!days) return "Trailing window";
  if (days % 30 === 0 && days >= 60) return `Last ${days / 30} months`;
  if (days % 7 === 0 && days < 90) return `Last ${days / 7} weeks`;
  return `Last ${days} days`;
}

export default function AdsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTeam, currentRole } = useTeam();
  const teamId = currentTeam?.id;

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null,
  );
  const projects = projectsData?.projects ?? [];

  // URL `project_id` absent => "All projects" mode (sentinel `__all__`).
  const [projectId, setProjectIdState] = useState<string>(
    searchParams.get("project_id") ?? ALL_PROJECTS,
  );
  const [appId, setAppIdState] = useState<string | null>(searchParams.get("app_id"));
  const [source, setSourceState] = useState<string>(searchParams.get("source") ?? DEFAULT_SOURCE);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
  }, []);

  const isAllProjects = projectId === ALL_PROJECTS;
  const projectInfoMap = useProjectInfoMap(isAllProjects ? teamId : undefined);

  // Set of expanded campaign keys, keyed `${row.project_id ?? projectId}:${row.id}`
  // so all-projects mode (where same-named campaigns can share Apple IDs across
  // ASA orgs) doesn't collide.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  // Filter changes invalidate any expanded row's data context, so collapse all.
  useEffect(() => {
    setExpanded(new Set());
  }, [projectId, appId, source]);

  function updateUrl(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "" || v === ALL_PROJECTS) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.replace(`/dashboard/ads${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  function setProjectId(v: string) {
    setProjectIdState(v);
    setAppIdState(null);
    updateUrl({ project_id: v, app_id: null });
  }
  function setAppId(v: string | null) {
    setAppIdState(v);
    updateUrl({ app_id: v });
  }
  function setSource(v: string) {
    setSourceState(v);
    updateUrl({ source: v });
  }

  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    teamId ? `/v1/apps?team_id=${teamId}` : null,
  );
  const allApps = appsData?.apps ?? [];
  const availableApps = !isAllProjects && projectId
    ? allApps.filter((a) => a.project_id === projectId)
    : allApps;

  useEffect(() => {
    if (!isAllProjects && projectId && appId) {
      const stillValid = availableApps.some((a) => a.id === appId);
      if (!stillValid) setAppId(null);
    }
  }, [isAllProjects, projectId, appId, availableApps]); // eslint-disable-line react-hooks/exhaustive-deps

  const singleProject = useAdCampaigns(isAllProjects ? undefined : projectId || undefined, {
    attribution_source: source,
    ...(appId ? { app_id: appId } : {}),
  });
  const allProjects = useAdCampaignsAcrossTeam(isAllProjects ? teamId : undefined, {
    attribution_source: source,
  });
  const active = isAllProjects ? allProjects : singleProject;
  const {
    campaigns,
    totalUserCount,
    totalPayingUserCount,
    totalRevenueUsd,
    totalSpendUsd,
    windowDays,
    revenueSyncedAt,
    adMetricsSyncedAt,
    currencyWarning,
    isLoading,
    mutate,
  } = active;
  const totalRoas =
    totalSpendUsd != null && totalSpendUsd > 0 ? totalRevenueUsd / totalSpendUsd : null;

  const isAdmin = currentRole === "owner" || currentRole === "admin";

  function rowKey(row: AdsRow & { project_id?: string }) {
    return `${row.project_id ?? projectId}:${row.id}`;
  }

  // In team mode, group campaigns into per-project buckets sorted by ROAS
  // desc (revenue desc as tie-break for null-spend buckets). Server already
  // returns campaigns in revenue-desc order, so each bucket's `rows` inherits
  // that ordering for free. Reads from `allProjects.campaigns` directly so
  // the `TeamAdsRow[]` type is preserved without a cast.
  const projectBuckets = useMemo(
    () => (isAllProjects ? bucketByProject(allProjects.campaigns) : []),
    [isAllProjects, allProjects.campaigns],
  );

  function renderCampaigns() {
    if (isLoading) return <TableSkeleton rows={5} />;
    if (campaigns.length === 0) return <EmptyState />;

    if (isAllProjects) {
      // Force Spend / ROAS columns on across every per-project table when any
      // bucket has spend data, so columns line up vertically across sections.
      const anySpend = projectBuckets.some((b) => b.totalSpendUsd != null);
      return (
        <div className="space-y-6">
          {projectBuckets.map((bucket) => {
            const info = projectInfoMap.get(bucket.projectId);
            return (
              <ProjectAdsSection
                key={bucket.projectId}
                projectName={info?.name ?? "Unknown project"}
                projectColor={info?.color ?? null}
                bucket={bucket}
                forceShowSpend={anySpend}
                expandable={{
                  isExpanded: (row) => expanded.has(rowKey(row)),
                  onToggle: (row) => toggleExpanded(rowKey(row)),
                  renderExpanded: (row) => (
                    <CampaignAdGroupsRow
                      projectId={row.project_id ?? bucket.projectId}
                      campaignId={row.id}
                      source={source}
                      appId={null}
                      forceShowSpend={anySpend}
                    />
                  ),
                }}
              />
            );
          })}
        </div>
      );
    }

    const parentShowSpend = campaigns.some((r) => r.total_spend_usd != null);
    return (
      <AdsRowTable
        rows={campaigns}
        nameHeader="Campaign"
        emptyMessage="No campaigns with attributed users yet."
        highlightTop
        expandable={{
          isExpanded: (row) => expanded.has(rowKey(row)),
          onToggle: (row) => toggleExpanded(rowKey(row)),
          renderExpanded: (row) => (
            <CampaignAdGroupsRow
              projectId={row.project_id ?? projectId}
              campaignId={row.id}
              source={source}
              appId={appId}
              forceShowSpend={parentShowSpend}
            />
          ),
        }}
      />
    );
  }

  async function handleSync() {
    if (isAllProjects || !projectId) return;
    setSyncing(true);
    setSyncError(null);
    try {
      await adsActions.sync(projectId);
      // Sync runs async on the server (one user at a time, ~350ms each), so
      // there's no point refetching immediately — schedule a single refresh
      // a few seconds out and clear it on unmount to avoid setState-after-unmount.
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        void mutate();
        refetchTimerRef.current = null;
      }, 5_000);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  // ad_metrics_synced_at is set by `apple_ads_sync` for any project with the
  // integration enabled, so it's our proxy for "ASA integration connected and
  // syncing". When set, suppress the "Connect Apple Search Ads" CTA — the
  // problem isn't a missing integration, it's that no users are attributed yet.
  const isAdsIntegrationConnected = adMetricsSyncedAt != null;
  const integrationsHint = isAdsIntegrationConnected ? (
    <span className="text-xs text-muted-foreground">Awaiting attributed users</span>
  ) : (
    <Link
      href="/dashboard/integrations"
      className="text-xs text-primary hover:underline relative z-10"
    >
      Connect Apple Search Ads →
    </Link>
  );

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-muted-foreground" />
            Advertising insights
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {windowDaysLabel(windowDays)} — spend pulled from the network's reporting API; revenue
            from RevenueCat. Both sides scope to users acquired in the same window so ROAS stays
            comparable.
          </p>
        </div>
        {syncError && <p className="text-xs text-destructive mt-2">{syncError}</p>}
        {currencyWarning && (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            Spend is reported in <span className="font-medium">{currencyWarning}</span>; ROAS is hidden until USD support lands. Raw amounts are still stored.
          </div>
        )}
      </StaggerItem>

      <StaggerItem index={1}>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <AdsFilterBar
            projects={projects}
            apps={availableApps}
            projectId={projectId}
            appId={appId}
            attributionSource={source}
            onProjectChange={setProjectId}
            onAppChange={setAppId}
            onAttributionSourceChange={setSource}
          />
          <div className="flex items-end gap-3 ml-auto">
            {(revenueSyncedAt || adMetricsSyncedAt) && (
              <div className="flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
                {revenueSyncedAt && (
                  <span>
                    Revenue synced{" "}
                    <span className="font-medium text-foreground">{timeAgo(revenueSyncedAt)}</span>
                  </span>
                )}
                {adMetricsSyncedAt && (
                  <span>
                    Spend synced{" "}
                    <span className="font-medium text-foreground">{timeAgo(adMetricsSyncedAt)}</span>
                  </span>
                )}
              </div>
            )}
            {isAdmin && !isAllProjects && projectId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSync()}
                disabled={syncing}
              >
                <RefreshCw className={"h-3.5 w-3.5 mr-1 " + (syncing ? "animate-spin" : "")} />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            )}
          </div>
        </div>
      </StaggerItem>

      <StaggerItem index={2}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard label="Attributed users" value={totalUserCount.toLocaleString()} />
          <SummaryCard label="Paying users" value={totalPayingUserCount.toLocaleString()} />
          <SummaryCard label="Lifetime revenue" value={formatUsd(totalRevenueUsd)} prominent />
          <SummaryCard
            label="Lifetime spend"
            value={totalSpendUsd == null ? null : formatUsd(totalSpendUsd)}
            emptyHint={integrationsHint}
          />
          <SummaryCard
            label="ROAS"
            value={totalRoas == null ? null : formatRoasLabel(totalRoas)}
            tone={totalRoas == null ? undefined : roasTone(totalRoas)}
            emptyHint={totalSpendUsd == null ? integrationsHint : "Awaiting spend data"}
          />
        </div>
      </StaggerItem>

      <StaggerItem index={3}>
        {!isLoading && campaigns.length > 0 && (
          <p className="text-xs text-muted-foreground mb-2 px-1">
            Click any row to expand its ad groups, keywords, and ads inline.
          </p>
        )}
        {renderCampaigns()}
      </StaggerItem>
    </AnimatedPage>
  );
}

const SUMMARY_TONE_CLASS: Record<RoasTone, string> = {
  muted: "",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

function SummaryCard({
  label,
  value,
  tone,
  prominent = false,
  emptyHint,
}: {
  label: string;
  /** `null` means "no data" — render `emptyHint` instead. */
  value: string | null;
  tone?: RoasTone;
  /** Bumps the number to text-3xl + lifts the card with a subtle ring; reserve for the headline metric. */
  prominent?: boolean;
  /** Shown when `value` is null. ReactNode so callers can inline a link. */
  emptyHint?: ReactNode;
}) {
  const isEmpty = value == null;
  const numberClass = prominent
    ? "text-3xl font-semibold tabular-nums mt-1"
    : "text-2xl font-semibold tabular-nums mt-1";
  const cardClass = prominent
    ? "ring-1 ring-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] to-transparent"
    : "";
  return (
    <Card className={cardClass}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        {isEmpty ? (
          <div className="mt-1 min-h-[2rem] flex items-end">
            {typeof emptyHint === "string" ? (
              <span className="text-xs text-muted-foreground">{emptyHint}</span>
            ) : (
              emptyHint ?? <span className="text-2xl font-semibold tabular-nums text-muted-foreground">—</span>
            )}
          </div>
        ) : (
          <div className={`${numberClass} ${tone ? SUMMARY_TONE_CLASS[tone] : ""}`}>{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="p-6 space-y-3 text-sm">
        <p>No attributed users yet for this source.</p>
        <p className="text-muted-foreground">
          Apple Search Ads attribution is captured automatically by the Owlmetry Swift SDK
          (no code required) and backfilled from RevenueCat for users who installed before
          the SDK shipped attribution capture. Make sure both integrations are configured.
        </p>
        <Link
          href="/dashboard/integrations"
          className="inline-block text-primary underline-offset-2 hover:underline"
        >
          Manage integrations →
        </Link>
      </CardContent>
    </Card>
  );
}
