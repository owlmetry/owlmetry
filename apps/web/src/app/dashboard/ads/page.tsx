"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import type { ProjectResponse, AppResponse } from "@owlmetry/shared";
import { ATTRIBUTION_SOURCE_VALUES } from "@owlmetry/shared/attribution";
import { useTeam } from "@/contexts/team-context";
import { useAdCampaigns, adsActions } from "@/hooks/use-ads";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { TableSkeleton } from "@/components/ui/skeletons";
import { Megaphone, RefreshCw } from "lucide-react";
import { formatUsd } from "@/lib/currency";
import { timeAgo } from "@/app/dashboard/_components/time-ago";
import { AdsFilterBar } from "./_components/ads-filter-bar";
import { AdsRowTable } from "./_components/ads-row-table";

const DEFAULT_SOURCE = ATTRIBUTION_SOURCE_VALUES.appleSearchAds;

export default function AdsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTeam, currentRole } = useTeam();
  const teamId = currentTeam?.id;

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null,
  );
  const projects = projectsData?.projects ?? [];

  const [projectId, setProjectIdState] = useState<string>(searchParams.get("project_id") ?? "");
  const [appId, setAppIdState] = useState<string | null>(searchParams.get("app_id"));
  const [source, setSourceState] = useState<string>(searchParams.get("source") ?? DEFAULT_SOURCE);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
  }, []);

  // Default to the first project if URL didn't pin one. Wait for projects to
  // load so we don't flicker through an empty selection on mount.
  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectIdState(projects[0].id);
    }
  }, [projectId, projects]);

  function updateUrl(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") params.delete(k);
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
    teamId && projectId ? `/v1/apps?team_id=${teamId}&project_id=${projectId}` : null,
  );
  const apps = appsData?.apps ?? [];

  const { campaigns, totalUserCount, totalPayingUserCount, totalRevenueUsd, revenueSyncedAt, isLoading, mutate } =
    useAdCampaigns(projectId || undefined, {
      attribution_source: source,
      ...(appId ? { app_id: appId } : {}),
    });

  const isAdmin = currentRole === "owner" || currentRole === "admin";

  function renderCampaigns() {
    if (isLoading) return <TableSkeleton rows={5} />;
    if (!projectId) {
      return (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Pick a project above to see campaigns.
          </CardContent>
        </Card>
      );
    }
    if (campaigns.length === 0) return <EmptyState />;
    return (
      <AdsRowTable
        rows={campaigns}
        nameHeader="Campaign"
        rowHref={(row) =>
          `/dashboard/ads/${encodeURIComponent(row.id)}?project_id=${projectId}&source=${source}${appId ? `&app_id=${appId}` : ""}`
        }
        emptyMessage="No campaigns with attributed users yet."
      />
    );
  }

  async function handleSync() {
    if (!projectId) return;
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

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-muted-foreground" />
              Advertising insights
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Campaigns ranked by lifetime USD revenue from attributed users.
              {revenueSyncedAt && (
                <>
                  {" "}Revenue last synced <span className="font-medium">{timeAgo(revenueSyncedAt)}</span>.
                </>
              )}
            </p>
          </div>
          {isAdmin && projectId && (
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
        {syncError && <p className="text-xs text-destructive mt-2">{syncError}</p>}
      </StaggerItem>

      <StaggerItem index={1}>
        <AdsFilterBar
          projects={projects}
          apps={apps}
          projectId={projectId}
          appId={appId}
          attributionSource={source}
          onProjectChange={setProjectId}
          onAppChange={setAppId}
          onAttributionSourceChange={setSource}
        />
      </StaggerItem>

      <StaggerItem index={2}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard label="Attributed users" value={totalUserCount.toLocaleString()} />
          <SummaryCard label="Paying users" value={totalPayingUserCount.toLocaleString()} />
          <SummaryCard label="Lifetime revenue" value={formatUsd(totalRevenueUsd)} />
        </div>
      </StaggerItem>

      <StaggerItem index={3}>{renderCampaigns()}</StaggerItem>
    </AnimatedPage>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
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
