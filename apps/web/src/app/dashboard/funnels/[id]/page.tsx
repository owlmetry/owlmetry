"use client";

import { useEffect, useMemo, useDeferredValue } from "react";
import { useParams, usePathname } from "next/navigation";
import useSWR from "swr";
import type { FunnelDefinitionResponse, AppResponse, ProjectResponse } from "@owlmetry/shared";
import { useDataMode } from "@/contexts/data-mode-context";
import { useBreadcrumbs } from "@/contexts/breadcrumb-context";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useFunnelQuery } from "@/hooks/use-funnels";
import { AnalyticsFilterBar } from "@/components/analytics-filter-bar";
import type { FilterChip } from "@/components/filter-sheet";
import { TIME_RANGES, formatTimeRangeChip } from "@/lib/time-ranges";
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
import { ProjectDot } from "@/lib/project-color";

const FUNNEL_GROUP_BY_OPTIONS = [
  { value: "environment", label: "Environment" },
  { value: "app_version", label: "App Version" },
];

export default function FunnelDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const pathname = usePathname();
  const { dataMode } = useDataMode();
  const { setBreadcrumbs } = useBreadcrumbs();

  // Fetch funnel definition by UUID
  const { data: funnelData } = useSWR<FunnelDefinitionResponse>(
    `/v1/funnels/by-id/${id}`,
  );

  const slug = funnelData?.slug;
  const projectId = funnelData?.project_id;

  useEffect(() => {
    if (funnelData?.name) {
      setBreadcrumbs(
        [{ label: "Funnels", href: "/dashboard/funnels" }, { label: funnelData.name }],
        pathname,
      );
    }
  }, [funnelData?.name, pathname, setBreadcrumbs]);

  const filters = useUrlFilters({
    path: `/dashboard/funnels/${id}`,
    defaults: {
      time_range: "7d",
      since: "",
      until: "",
      app_version: "",
      environment: "",
      experiment: "",
      group_by: "",
      mode: "open",
      app_id: "",
    },
  });

  const deferredAppVersion = useDeferredValue(filters.get("app_version"));
  const deferredExperiment = useDeferredValue(filters.get("experiment"));
  const closedMode = filters.get("mode") === "closed";

  // Fetch apps for app_id filter
  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    projectId ? `/v1/apps?project_id=${projectId}` : null,
  );
  const apps = appsData?.apps ?? [];
  const { data: projectData } = useSWR<ProjectResponse>(
    projectId ? `/v1/projects/${projectId}` : null,
  );
  const projectColor = projectData?.color;

  // Query
  const { data: queryData, isLoading } = useFunnelQuery(slug, projectId, {
    since: filters.computedSince,
    until: filters.computedUntil,
    app_id: filters.get("app_id") || undefined,
    app_version: deferredAppVersion || undefined,
    environment: filters.get("environment") || undefined,
    experiment: deferredExperiment || undefined,
    mode: closedMode ? "closed" : "open",
    group_by: filters.get("group_by") || undefined,
    data_mode: dataMode,
  });

  const analytics = queryData?.analytics;

  const timeRange = filters.get("time_range");
  const sinceInput = filters.get("since");
  const untilInput = filters.get("until");
  const environmentVal = filters.get("environment");
  const appVersionVal = filters.get("app_version");
  const experimentVal = filters.get("experiment");

  const chips = useMemo(() => {
    const c: FilterChip[] = [];
    if (timeRange && timeRange !== "7d") c.push({ label: "Time", value: formatTimeRangeChip(timeRange, sinceInput, untilInput), onDismiss: () => filters.setMany({ time_range: "7d", since: "", until: "" }) });
    if (environmentVal) c.push({ label: "Env", value: environmentVal, onDismiss: () => filters.set("environment", "") });
    if (appVersionVal) c.push({ label: "Version", value: appVersionVal, onDismiss: () => filters.set("app_version", "") });
    if (experimentVal) c.push({ label: "Experiment", value: experimentVal, onDismiss: () => filters.set("experiment", "") });
    if (closedMode) c.push({ label: "Mode", value: "Sequential", onDismiss: () => filters.set("mode", "open") });
    return c;
  }, [timeRange, sinceInput, untilInput, environmentVal, appVersionVal, experimentVal, closedMode, filters]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">{funnelData?.name ?? "Loading..."}</h1>
        {funnelData?.description && (
          <p className="text-sm text-muted-foreground mt-1">{funnelData.description}</p>
        )}
      </div>

      {/* Filter bar */}
      <AnalyticsFilterBar
        filters={filters}
        groupByOptions={FUNNEL_GROUP_BY_OPTIONS}
        groupByAllowNone
        chips={chips}
        leadingChildren={
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">App</label>
            <Select
              value={filters.get("app_id") || "all"}
              onValueChange={(v) => filters.set("app_id", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All apps" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All apps</SelectItem>
                {apps.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="flex items-center gap-2">
                      <ProjectDot color={projectColor} />
                      {a.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Experiment</label>
          <Input
            type="text"
            placeholder="name:variant"
            value={filters.get("experiment")}
            onChange={(e) => filters.set("experiment", e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        {/* Sequential mode toggle */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-2 h-8 cursor-pointer select-none">
                <Checkbox
                  checked={closedMode}
                  onCheckedChange={(checked) =>
                    filters.set("mode", checked === true ? "closed" : "open")
                  }
                />
                <span className="text-xs font-medium">Sequential</span>
              </label>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="max-w-[220px]">
                Require users to complete steps in order. A user only counts at step N if they
                completed all previous steps first.
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
          <TooltipProvider>
            <div className="flex items-center gap-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Card className="cursor-help">
                    <CardContent className="pt-4 pb-3 px-4">
                      <p className="text-xs text-muted-foreground">Total Users (Step 1)</p>
                      <p className="text-lg font-semibold mt-0.5">{analytics.total_users.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="max-w-[260px]">
                    Unique users who entered the funnel by completing the first step during the
                    selected time range.
                  </p>
                </TooltipContent>
              </Tooltip>
              {analytics.steps.length >= 2 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Card className="cursor-help">
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
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="max-w-[260px]">
                      Percentage of step-1 users who reached the final step. In Open mode a user
                      counts if they ever completed the final step; in Sequential mode they must
                      have completed every step in order.
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Card className="cursor-help">
                    <CardContent className="pt-4 pb-3 px-4">
                      <p className="text-xs text-muted-foreground">Mode</p>
                      <p className="text-lg font-semibold mt-0.5 capitalize">{analytics.mode}</p>
                    </CardContent>
                  </Card>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="max-w-[260px]">
                    Open: steps can be completed in any order; a user counts at step N as long as
                    they also did step 1. Sequential: users only count at step N if they completed
                    steps 1…N-1 first. Toggle via the Sequential checkbox in the filter bar.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>

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
