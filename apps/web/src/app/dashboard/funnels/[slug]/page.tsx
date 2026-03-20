"use client";

import { useState, useMemo, useDeferredValue } from "react";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { FunnelDefinitionResponse } from "@owlmetry/shared";
import { useDataMode } from "@/contexts/data-mode-context";
import { useFunnelQuery } from "@/hooks/use-funnels";
import { FunnelChart } from "@/components/funnels/funnel-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { X } from "lucide-react";

const TIME_RANGES = [
  { label: "Last hour", value: "1h" },
  { label: "Last 24h", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Custom", value: "custom" },
];

const ENVIRONMENTS = ["ios", "ipados", "macos", "android", "web", "backend"] as const;

function sinceFromRange(range: string): string {
  const now = Date.now();
  const ms: Record<string, number> = {
    "1h": 3600_000,
    "24h": 86400_000,
    "7d": 604800_000,
    "30d": 2592000_000,
  };
  return new Date(now - (ms[range] ?? ms["24h"])).toISOString();
}

export default function FunnelDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const projectId = searchParams.get("project_id") ?? "";

  const [timeRange, setTimeRange] = useState("7d");
  const [sinceInput, setSinceInput] = useState("");
  const [untilInput, setUntilInput] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const deferredAppVersion = useDeferredValue(appVersion);
  const [environment, setEnvironment] = useState("");
  const [experiment, setExperiment] = useState("");
  const deferredExperiment = useDeferredValue(experiment);
  const [openMode, setOpenMode] = useState(false);
  const [groupBy, setGroupBy] = useState("");
  const { dataMode } = useDataMode();

  // Fetch funnel definition
  const { data: funnelData } = useSWR<FunnelDefinitionResponse>(
    projectId ? `/v1/funnels/${slug}?project_id=${projectId}` : null,
  );

  const computedSince = useMemo(() => {
    if (sinceInput) return new Date(sinceInput).toISOString();
    if (timeRange === "custom") return undefined;
    return sinceFromRange(timeRange);
  }, [sinceInput, timeRange]);

  const computedUntil = useMemo(() => {
    if (!untilInput) return undefined;
    const d = new Date(untilInput);
    d.setDate(d.getDate() + 1);
    return d.toISOString();
  }, [untilInput]);

  const hasActiveFilters =
    sinceInput ||
    untilInput ||
    appVersion ||
    environment ||
    experiment ||
    timeRange !== "7d" ||
    groupBy;

  function clearFilters() {
    setTimeRange("7d");
    setSinceInput("");
    setUntilInput("");
    setAppVersion("");
    setEnvironment("");
    setExperiment("");
    setGroupBy("");
  }

  function handleTimeRangeChange(value: string) {
    setTimeRange(value);
    if (value !== "custom") {
      setSinceInput("");
      setUntilInput("");
    }
  }

  function handleDateChange(field: "since" | "until", value: string) {
    if (field === "since") setSinceInput(value);
    else setUntilInput(value);
    if (value) setTimeRange("custom");
  }

  // Query
  const { data: queryData, isLoading } = useFunnelQuery(slug, projectId || undefined, {
    since: computedSince,
    until: computedUntil,
    app_version: deferredAppVersion || undefined,
    environment: environment || undefined,
    experiment: deferredExperiment || undefined,
    mode: openMode ? "open" : "closed",
    group_by: groupBy || undefined,
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
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Time Range</label>
          <Select value={timeRange} onValueChange={handleTimeRangeChange}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Since</label>
          <Input
            type="date"
            value={sinceInput}
            onChange={(e) => handleDateChange("since", e.target.value)}
            className="w-[140px] h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Until</label>
          <Input
            type="date"
            value={untilInput}
            onChange={(e) => handleDateChange("until", e.target.value)}
            className="w-[140px] h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">App Version</label>
          <Input
            type="text"
            placeholder="e.g. 1.0.0"
            value={appVersion}
            onChange={(e) => setAppVersion(e.target.value)}
            className="w-[120px] h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Environment</label>
          <Select
            value={environment || "all"}
            onValueChange={(v) => setEnvironment(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {ENVIRONMENTS.map((env) => (
                <SelectItem key={env} value={env}>
                  {env}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Experiment</label>
          <Input
            type="text"
            placeholder="name:variant"
            value={experiment}
            onChange={(e) => setExperiment(e.target.value)}
            className="w-[140px] h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Group By</label>
          <Select
            value={groupBy || "none"}
            onValueChange={(v) => setGroupBy(v === "none" ? "" : v)}
          >
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="environment">Environment</SelectItem>
              <SelectItem value="app_version">App Version</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Open funnel toggle */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-2 h-8 cursor-pointer select-none">
                <Checkbox
                  checked={openMode}
                  onCheckedChange={(checked) => setOpenMode(checked === true)}
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

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

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
