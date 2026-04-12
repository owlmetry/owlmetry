"use client";

import { useEffect, useState, useMemo, useDeferredValue } from "react";
import { useParams, usePathname } from "next/navigation";
import useSWR from "swr";
import { formatDuration } from "@owlmetry/shared/constants";
import type { MetricDefinitionResponse, AppResponse, MetricPhase } from "@owlmetry/shared";
import { useDataMode } from "@/contexts/data-mode-context";
import { useBreadcrumbs } from "@/contexts/breadcrumb-context";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useMetricQuery, useMetricEvents } from "@/hooks/use-metrics";
import { AnalyticsFilterBar } from "@/components/analytics-filter-bar";
import { type FilterChip, truncateId } from "@/components/filter-sheet";
import { TIME_RANGES, formatTimeRangeChip } from "@/lib/time-ranges";
import { formatShortDate, formatTime } from "@/lib/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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
import { BookOpen } from "lucide-react";

const METRIC_PHASES: MetricPhase[] = ["start", "complete", "fail", "cancel", "record"];

const PHASE_COLORS: Record<string, string> = {
  start: "bg-blue-500/10 text-blue-600",
  complete: "bg-green-500/10 text-green-600",
  fail: "bg-red-500/10 text-red-600",
  cancel: "bg-yellow-500/10 text-yellow-600",
  record: "bg-cyan-500/10 text-cyan-600",
};

const METRIC_GROUP_BY_OPTIONS = [
  { value: "time:hour", label: "Hour" },
  { value: "time:day", label: "Day" },
  { value: "time:week", label: "Week" },
  { value: "app_version", label: "App Version" },
  { value: "device_model", label: "Device" },
  { value: "os_version", label: "OS Version" },
  { value: "environment", label: "Environment" },
];

export default function MetricDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const pathname = usePathname();
  const { dataMode } = useDataMode();
  const { setBreadcrumbs } = useBreadcrumbs();

  // Fetch metric definition by UUID
  const { data: metricData } = useSWR<MetricDefinitionResponse>(
    `/v1/metrics/by-id/${id}`,
  );

  const slug = metricData?.slug;
  const projectId = metricData?.project_id;

  useEffect(() => {
    if (metricData?.name) {
      setBreadcrumbs(
        [{ label: "Metrics", href: "/dashboard/metrics" }, { label: metricData.name }],
        pathname,
      );
    }
  }, [metricData?.name, pathname, setBreadcrumbs]);

  const filters = useUrlFilters({
    path: `/dashboard/metrics/${id}`,
    defaults: {
      time_range: "24h",
      since: "",
      until: "",
      app_version: "",
      environment: "",
      group_by: "time:day",
      app_id: "",
      os_version: "",
      user_id: "",
      phase: "",
      tracking_id: "",
    },
  });

  const deferredAppVersion = useDeferredValue(filters.get("app_version"));
  const deferredOsVersion = useDeferredValue(filters.get("os_version"));
  const deferredUserId = useDeferredValue(filters.get("user_id"));
  const deferredTrackingId = useDeferredValue(filters.get("tracking_id"));
  const [docsOpen, setDocsOpen] = useState(false);

  // Fetch apps for app_id filter
  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    projectId ? `/v1/apps?project_id=${projectId}` : null,
  );
  const apps = appsData?.apps ?? [];

  // Aggregation query
  const { data: queryData, isLoading: queryLoading } = useMetricQuery(slug, projectId, {
    since: filters.computedSince,
    until: filters.computedUntil,
    app_id: filters.get("app_id") || undefined,
    app_version: deferredAppVersion || undefined,
    os_version: deferredOsVersion || undefined,
    user_id: deferredUserId || undefined,
    environment: filters.get("environment") || undefined,
    group_by: filters.get("group_by"),
    data_mode: dataMode,
  });

  // Raw events
  const { events, isLoading: eventsLoading } = useMetricEvents(slug, projectId, {
    since: filters.computedSince,
    until: filters.computedUntil,
    phase: (filters.get("phase") as MetricPhase) || undefined,
    tracking_id: deferredTrackingId || undefined,
    user_id: deferredUserId || undefined,
    environment: filters.get("environment") || undefined,
    data_mode: dataMode,
  });

  const agg = queryData?.aggregation;
  const isLifecycle = (agg?.start_count ?? 0) > 0 || (agg?.complete_count ?? 0) > 0;

  const timeRange = filters.get("time_range");
  const sinceInput = filters.get("since");
  const untilInput = filters.get("until");
  const environmentVal = filters.get("environment");
  const appVersionVal = filters.get("app_version");
  const userIdVal = filters.get("user_id");
  const osVersionVal = filters.get("os_version");

  const chips = useMemo(() => {
    const c: FilterChip[] = [];
    if (timeRange && timeRange !== "24h") c.push({ label: "Time", value: formatTimeRangeChip(timeRange, sinceInput, untilInput), onDismiss: () => filters.setMany({ time_range: "24h", since: "", until: "" }) });
    if (environmentVal) c.push({ label: "Env", value: environmentVal, onDismiss: () => filters.set("environment", "") });
    if (appVersionVal) c.push({ label: "Version", value: appVersionVal, onDismiss: () => filters.set("app_version", "") });
    if (userIdVal) c.push({ label: "User", value: truncateId(userIdVal), onDismiss: () => filters.set("user_id", "") });
    if (osVersionVal) c.push({ label: "OS", value: osVersionVal, onDismiss: () => filters.set("os_version", "") });
    return c;
  }, [timeRange, sinceInput, untilInput, environmentVal, appVersionVal, userIdVal, osVersionVal, filters]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{metricData?.name ?? "Loading..."}</h1>
          {metricData?.description && (
            <p className="text-sm text-muted-foreground mt-1">{metricData.description}</p>
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
      <AnalyticsFilterBar
        filters={filters}
        groupByOptions={METRIC_GROUP_BY_OPTIONS}
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
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">User ID</label>
          <Input
            type="text"
            placeholder="Filter by user"
            value={filters.get("user_id")}
            onChange={(e) => filters.set("user_id", e.target.value)}
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">OS Version</label>
          <Input
            type="text"
            placeholder="e.g. 18.0"
            value={filters.get("os_version")}
            onChange={(e) => filters.set("os_version", e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </AnalyticsFilterBar>

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
              <StatCard label="Avg Duration" value={formatDuration(agg.duration_avg_ms)} />
            )}
            <StatCard label="Unique Users" value={agg.unique_users} />
          </div>

          {/* Duration percentiles */}
          {agg.duration_p50_ms != null && (
            <div className="grid gap-3 grid-cols-3">
              <StatCard label="P50" value={formatDuration(agg.duration_p50_ms)} />
              <StatCard label="P95" value={agg.duration_p95_ms != null ? formatDuration(agg.duration_p95_ms) : "N/A"} />
              <StatCard label="P99" value={agg.duration_p99_ms != null ? formatDuration(agg.duration_p99_ms) : "N/A"} />
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
        <div className="flex items-end gap-3 flex-wrap mb-3">
          <h2 className="text-sm font-medium">Recent Events</h2>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Phase</label>
            <Select
              value={filters.get("phase") || "all"}
              onValueChange={(v) => filters.set("phase", v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="All phases" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All phases</SelectItem>
                {METRIC_PHASES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p === "start" ? "🚀 start" : p === "complete" ? "✅ complete" : p === "fail" ? "❌ fail" : p === "cancel" ? "🚫 cancel" : "📝 record"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Tracking ID</label>
            <Input
              type="text"
              placeholder="Filter by tracking ID"
              value={filters.get("tracking_id")}
              onChange={(e) => filters.set("tracking_id", e.target.value)}
              className="w-[160px] h-8 text-xs font-mono"
            />
          </div>
        </div>
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
                  const date = formatShortDate(ts);
                  const time = formatTime(ts);
                  return (
                    <TableRow key={`${event.timestamp}-${i}`}>
                      <TableCell className="font-mono text-xs py-1.5">{time} {date}</TableCell>
                      <TableCell className="py-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${PHASE_COLORS[event.phase] ?? ""}`}>
                          {event.phase === "start" ? "🚀 start" : event.phase === "complete" ? "✅ complete" : event.phase === "fail" ? "❌ fail" : event.phase === "cancel" ? "🚫 cancel" : "📝 record"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs py-1.5">
                        {event.duration_ms != null ? formatDuration(event.duration_ms) : "—"}
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
