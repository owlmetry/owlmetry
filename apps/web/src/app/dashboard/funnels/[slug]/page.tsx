"use client";

import { useDeferredValue } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import type { FunnelDefinitionResponse, AppResponse, ProjectResponse } from "@owlmetry/shared";
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useFunnelQuery } from "@/hooks/use-funnels";
import { AnalyticsFilterBar } from "@/components/analytics-filter-bar";
import { FunnelChart } from "@/components/funnels/funnel-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const FUNNEL_GROUP_BY_OPTIONS = [
  { value: "environment", label: "Environment" },
  { value: "app_version", label: "App Version" },
];

export default function FunnelDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { currentTeam } = useTeam();
  const { dataMode } = useDataMode();

  const filters = useUrlFilters({
    path: `/dashboard/funnels/${slug}`,
    defaults: {
      project_id: "",
      time_range: "7d",
      since: "",
      until: "",
      app_version: "",
      environment: "",
      experiment: "",
      group_by: "",
      mode: "closed",
      app_id: "",
    },
    persistKeys: ["project_id"],
  });

  // Fetch projects for the project selector
  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    currentTeam?.id ? `/v1/projects?team_id=${currentTeam.id}` : null,
  );
  const projects = projectsData?.projects ?? [];

  const projectId = filters.get("project_id");
  const deferredAppVersion = useDeferredValue(filters.get("app_version"));
  const deferredExperiment = useDeferredValue(filters.get("experiment"));
  const openMode = filters.get("mode") === "open";

  // Fetch apps for app_id filter
  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    projectId ? `/v1/apps?project_id=${projectId}` : null,
  );
  const apps = appsData?.apps ?? [];

  // Fetch funnel definition
  const { data: funnelData } = useSWR<FunnelDefinitionResponse>(
    projectId ? `/v1/funnels/${slug}?project_id=${projectId}` : null,
  );

  // Query
  const { data: queryData, isLoading } = useFunnelQuery(slug, projectId || undefined, {
    since: filters.computedSince,
    until: filters.computedUntil,
    app_id: filters.get("app_id") || undefined,
    app_version: deferredAppVersion || undefined,
    environment: filters.get("environment") || undefined,
    experiment: deferredExperiment || undefined,
    mode: openMode ? "open" : "closed",
    group_by: filters.get("group_by") || undefined,
    data_mode: dataMode,
  });

  const analytics = queryData?.analytics;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">{funnelData?.name ?? slug}</h1>
        {funnelData?.description && (
          <p className="text-sm text-muted-foreground mt-1">{funnelData.description}</p>
        )}
      </div>

      {/* Filter bar */}
      <AnalyticsFilterBar
        filters={filters}
        groupByOptions={FUNNEL_GROUP_BY_OPTIONS}
        groupByAllowNone
        leadingChildren={
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Project</label>
              <Select value={projectId} onValueChange={(v) => filters.set("project_id", v)}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">App</label>
              <Select
                value={filters.get("app_id") || "all"}
                onValueChange={(v) => filters.set("app_id", v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue placeholder="All apps" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All apps</SelectItem>
                  {apps.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        }
      >
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Experiment</label>
          <Input
            type="text"
            placeholder="name:variant"
            value={filters.get("experiment")}
            onChange={(e) => filters.set("experiment", e.target.value)}
            className="w-[160px] h-8 text-xs"
          />
        </div>

        {/* Open funnel toggle */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-2 h-8 cursor-pointer select-none">
                <Checkbox
                  checked={openMode}
                  onCheckedChange={(checked) =>
                    filters.set("mode", checked === true ? "open" : "closed")
                  }
                />
                <span className="text-xs font-medium">Open</span>
              </label>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="max-w-[220px]">
                Make this an open funnel. In an open funnel, users don&apos;t have to complete a
                previous step in order to be included in a subsequent step.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </AnalyticsFilterBar>

      {/* Content */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading funnel data...</p>
      ) : !analytics ? (
        <p className="text-sm text-muted-foreground">No data available</p>
      ) : (
        <>
          {/* Summary */}
          <div className="flex items-center gap-4">
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">Total Users (Step 1)</p>
                <p className="text-lg font-semibold mt-0.5">{analytics.total_users.toLocaleString()}</p>
              </CardContent>
            </Card>
            {analytics.steps.length >= 2 && (
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground">Conversion Rate</p>
                  <p className="text-lg font-semibold mt-0.5">
                    {analytics.steps[analytics.steps.length - 1].percentage}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {analytics.steps[analytics.steps.length - 1].unique_users.toLocaleString()} users reached final step
                  </p>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">Mode</p>
                <p className="text-lg font-semibold mt-0.5 capitalize">{analytics.mode}</p>
              </CardContent>
            </Card>
          </div>

          {/* Funnel chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Funnel Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <FunnelChart steps={analytics.steps} />
            </CardContent>
          </Card>

          {/* Breakdown groups */}
          {analytics.breakdown && analytics.breakdown.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium">Breakdown by {analytics.breakdown[0].key}</h2>
              {analytics.breakdown.map((group) => (
                <Card key={`${group.key}-${group.value}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{group.value}</CardTitle>
                      <span className="text-xs text-muted-foreground">
                        {group.total_users.toLocaleString()} users
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <FunnelChart steps={group.steps} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
