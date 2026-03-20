"use client";

import { useState, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { ProjectResponse, MetricDefinitionResponse, StoredMetricEventResponse } from "@owlmetry/shared";
import { useMetricQuery, useMetricEvents } from "@/hooks/use-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BreakdownChart } from "@/components/metrics/breakdown-chart";
import { TimeSeriesChart } from "@/components/metrics/time-series-chart";
import { MetricDocsSheet } from "@/components/metrics/metric-docs-sheet";
import { BookOpen, X } from "lucide-react";

const TIME_RANGES = [
  { label: "Last hour", value: "1h" },
  { label: "Last 24h", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Custom", value: "custom" },
];

const ENVIRONMENTS = ["ios", "ipados", "macos", "android", "web", "backend"];

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

const PHASE_COLORS: Record<string, string> = {
  start: "bg-blue-500/10 text-blue-600",
  complete: "bg-green-500/10 text-green-600",
  fail: "bg-red-500/10 text-red-600",
  cancel: "bg-yellow-500/10 text-yellow-600",
  record: "bg-cyan-500/10 text-cyan-600",
};

export default function MetricDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const projectId = searchParams.get("project_id") ?? "";

  const [timeRange, setTimeRange] = useState("24h");
  const [groupBy, setGroupBy] = useState("time:day");
  const [docsOpen, setDocsOpen] = useState(false);
  const [sinceInput, setSinceInput] = useState("");
  const [untilInput, setUntilInput] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [environment, setEnvironment] = useState("");

  // Fetch metric definition
  const { data: metricData } = useSWR<MetricDefinitionResponse>(
    projectId ? `/v1/metrics/${slug}?project_id=${projectId}` : null,
  );

  const computedSince = useMemo(() => {
    if (sinceInput) return new Date(sinceInput).toISOString();
    if (timeRange === "custom") return undefined;
    return sinceFromRange(timeRange);
  }, [sinceInput, timeRange]);

  const computedUntil = useMemo(() => {
    if (untilInput) return new Date(untilInput + "T23:59:59").toISOString();
    return undefined;
  }, [untilInput]);

  const hasActiveFilters = sinceInput || untilInput || appVersion || environment || timeRange !== "24h" || groupBy !== "time:day";

  function clearFilters() {
    setTimeRange("24h");
    setGroupBy("time:day");
    setSinceInput("");
    setUntilInput("");
    setAppVersion("");
    setEnvironment("");
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

  // Aggregation query
  const { data: queryData, isLoading: queryLoading } = useMetricQuery(slug, projectId || undefined, {
    since: computedSince,
    until: computedUntil,
    app_version: appVersion || undefined,
    environment: environment || undefined,
    group_by: groupBy,
  });

  // Raw events
  const { events, isLoading: eventsLoading } = useMetricEvents(slug, projectId || undefined, {
    since: computedSince,
    until: computedUntil,
    environment: environment || undefined,
    include_debug: "true",
  });

  const agg = queryData?.aggregation;
  const isLifecycle = (agg?.start_count ?? 0) > 0 || (agg?.complete_count ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{metricData?.name ?? slug}</h1>
          {metricData?.description && (
            <p className="text-sm text-muted-foreground mt-1">{metricData.description}</p>
          )}
          {metricData && (
            <span
              className={`mt-2 inline-block text-[10px] px-1.5 py-0.5 rounded-full ${
                metricData.status === "active"
                  ? "bg-green-500/10 text-green-600"
                  : "bg-yellow-500/10 text-yellow-600"
              }`}
            >
              {metricData.status}
            </span>
          )}
        </div>
        {metricData?.documentation && (
          <Button variant="outline" size="sm" onClick={() => setDocsOpen(true)}>
            <BookOpen className="h-4 w-4 mr-1" />
            Docs
          </Button>
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
          <Select value={environment || "all"} onValueChange={(v) => setEnvironment(v === "all" ? "" : v)}>
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
          <label className="text-xs text-muted-foreground">Group By</label>
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="time:hour">Hour</SelectItem>
              <SelectItem value="time:day">Day</SelectItem>
              <SelectItem value="time:week">Week</SelectItem>
              <SelectItem value="app_version">App Version</SelectItem>
              <SelectItem value="device_model">Device</SelectItem>
              <SelectItem value="os_version">OS Version</SelectItem>
              <SelectItem value="environment">Environment</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {queryLoading ? (
        <p className="text-sm text-muted-foreground">Loading metrics...</p>
      ) : !agg ? (
        <p className="text-sm text-muted-foreground">No data available</p>
      ) : (
        <>
          {/* Summary stat cards */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
            <StatCard label="Total Events" value={agg.total_count} />
            {isLifecycle && (
              <>
                <StatCard
                  label="Success Rate"
                  value={agg.success_rate != null ? `${agg.success_rate}%` : "N/A"}
                  subtitle={`${agg.complete_count} / ${agg.complete_count + agg.fail_count}`}
                />
                <StatCard label="Failed" value={agg.fail_count} variant={agg.fail_count > 0 ? "danger" : undefined} />
                <StatCard label="Cancelled" value={agg.cancel_count} />
              </>
            )}
            {!isLifecycle && <StatCard label="Records" value={agg.record_count} />}
            {agg.duration_avg_ms != null && (
              <StatCard label="Avg Duration" value={`${agg.duration_avg_ms}ms`} />
            )}
            <StatCard label="Unique Users" value={agg.unique_users} />
          </div>

          {/* Duration percentiles */}
          {agg.duration_p50_ms != null && (
            <div className="grid gap-3 grid-cols-3">
              <StatCard label="P50" value={`${agg.duration_p50_ms}ms`} />
              <StatCard label="P95" value={`${agg.duration_p95_ms ?? "N/A"}ms`} />
              <StatCard label="P99" value={`${agg.duration_p99_ms ?? "N/A"}ms`} />
            </div>
          )}

          {/* Time series chart */}
          {agg.groups && agg.groups.length > 0 && agg.groups[0].key?.startsWith("time:") && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Operations Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                <TimeSeriesChart
                  data={agg.groups.map((g) => ({
                    bucket: g.value,
                    count: g.total_count,
                    complete_count: g.complete_count,
                    fail_count: g.fail_count,
                  }))}
                />
              </CardContent>
            </Card>
          )}

          {/* Attribute breakdown (for non-time groupings) */}
          {agg.groups && agg.groups.length > 0 && !agg.groups[0].key?.startsWith("time:") && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Breakdown by {agg.groups[0].key}</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownChart
                  title=""
                  data={agg.groups.map((g) => ({ label: g.value, count: g.total_count }))}
                  total={agg.total_count}
                />
              </CardContent>
            </Card>
          )}

          {/* Error breakdown */}
          {agg.error_breakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Error Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownChart
                  title=""
                  data={agg.error_breakdown.map((e) => ({ label: e.error, count: e.count }))}
                  total={agg.fail_count}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Recent metric events table */}
      <div>
        <h2 className="text-sm font-medium mb-3">Recent Events</h2>
        {eventsLoading ? (
          <p className="text-sm text-muted-foreground">Loading events...</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No metric events found</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Time</TableHead>
                  <TableHead className="w-[80px]">Phase</TableHead>
                  <TableHead className="w-[100px]">Duration</TableHead>
                  <TableHead className="w-[140px]">User</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Attributes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.slice(0, 50).map((event, i) => {
                  const ts = new Date(event.timestamp);
                  const time = ts.toLocaleTimeString("en-US", { hour12: false });
                  return (
                    <TableRow key={`${event.timestamp}-${i}`}>
                      <TableCell className="font-mono text-xs py-1.5">{time}</TableCell>
                      <TableCell className="py-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${PHASE_COLORS[event.phase] ?? ""}`}>
                          {event.phase}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs py-1.5">
                        {event.duration_ms != null ? `${event.duration_ms}ms` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs py-1.5 truncate max-w-[140px]">
                        {event.user_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs py-1.5 text-red-500 truncate max-w-[200px]">
                        {event.error ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs py-1.5 text-muted-foreground truncate max-w-[200px]">
                        {event.attributes ? JSON.stringify(event.attributes).slice(0, 80) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Docs sheet */}
      {metricData && (
        <MetricDocsSheet
          open={docsOpen}
          onOpenChange={setDocsOpen}
          name={metricData.name}
          documentation={metricData.documentation}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  variant,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  variant?: "danger";
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-semibold mt-0.5 ${variant === "danger" ? "text-red-500" : ""}`}>
          {value}
        </p>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}
