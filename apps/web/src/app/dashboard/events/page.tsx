"use client";

import { useState, useEffect, useMemo } from "react";
import useSWR from "swr";
import type {
  EventsQueryParams,
  StoredEventResponse,
  ProjectResponse,
  AppResponse,
  LogLevel,
} from "@owlmetry/shared";
import { TIME_RANGES, ENVIRONMENTS } from "@/lib/time-ranges";
import { FilterSheet, type FilterChip, resolveEntityName, truncateId } from "@/components/filter-sheet";
import { formatTimeRangeChip } from "@/lib/time-ranges";

const LOG_LEVELS: LogLevel[] = ["info", "debug", "warn", "error"];
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useEvents } from "@/hooks/use-events";
import { isDefaultColumnOrder } from "@owlmetry/shared";
import { useUserPreferences, useUpdateUserPreferences } from "@/hooks/use-user-preferences";
import { useProjectColorMap, useAppColorMap } from "@/hooks/use-project-colors";
import { EventDetailSheet } from "@/components/event-detail-sheet";
import { ProjectDot } from "@/lib/project-color";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { TableSkeleton } from "@/components/ui/skeletons";
import { ConfigurableTable } from "@/components/configurable-table";
import { ColumnPicker } from "@/components/column-picker";
import {
  EVENT_COLUMN_REGISTRY,
  DEFAULT_EVENT_COLUMN_ORDER,
  type EventColumnHelpers,
} from "@/lib/event-columns";

export default function EventsPage() {
  const { currentTeam } = useTeam();
  const { dataMode } = useDataMode();
  const teamId = currentTeam?.id;

  const filters = useUrlFilters({
    path: "/dashboard/events",
    defaults: {
      project_id: "",
      app_id: "",
      level: "",
      user_id: "",
      session_id: "",
      environment: "",
      screen_name: "",
      time_range: "",
      since: "",
      until: "",
      order: "",
      event_id: "",
    },
    persistKeys: ["event_id"],
  });

  // Selected event for detail sheet — open state is derived from URL event_id
  const [selectedEvent, setSelectedEvent] = useState<StoredEventResponse | null>(null);
  const eventIdParam = filters.get("event_id");
  const sheetOpen = !!eventIdParam;

  // Projects & apps for filter dropdowns
  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null
  );
  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    teamId ? `/v1/apps?team_id=${teamId}` : null
  );

  const projects = projectsData?.projects ?? [];
  const allApps = appsData?.apps ?? [];

  const projectId = filters.get("project_id");
  const appId = filters.get("app_id");

  // Derive available apps based on selected project
  const availableApps = projectId
    ? allApps.filter((a) => a.project_id === projectId)
    : allApps;

  // Build filter params
  const filterParams: EventsQueryParams = {};
  if (teamId) filterParams.team_id = teamId;
  if (projectId) filterParams.project_id = projectId;
  if (appId) filterParams.app_id = appId;
  const level = filters.get("level");
  if (level) filterParams.level = level;
  const userId = filters.get("user_id");
  if (userId) filterParams.user_id = userId;
  const sessionId = filters.get("session_id");
  if (sessionId) filterParams.session_id = sessionId;
  const environment = filters.get("environment");
  if (environment) filterParams.environment = environment;
  const screenName = filters.get("screen_name");
  if (screenName) filterParams.screen_name = screenName;
  if (filters.computedSince) filterParams.since = filters.computedSince;
  if (filters.computedUntil) filterParams.until = filters.computedUntil;
  filterParams.data_mode = dataMode;
  const order = filters.get("order");
  if (order === "asc" || order === "desc") filterParams.order = order;

  const { events, isLoading, isLoadingMore, hasMore, loadMore } = useEvents(filterParams);

  // Resolve selectedEvent from URL event_id: prefer loaded list, fall back to fetching by id
  const eventInList = useMemo(
    () => (eventIdParam ? events.find((e) => e.id === eventIdParam) ?? null : null),
    [eventIdParam, events],
  );
  const { data: fetchedEvent } = useSWR<StoredEventResponse>(
    eventIdParam && !eventInList ? `/v1/events/${eventIdParam}` : null,
  );
  useEffect(() => {
    if (!eventIdParam) {
      setSelectedEvent(null);
      return;
    }
    if (eventInList) {
      setSelectedEvent(eventInList);
    } else if (fetchedEvent && fetchedEvent.id === eventIdParam) {
      setSelectedEvent(fetchedEvent);
    }
  }, [eventIdParam, eventInList, fetchedEvent]);

  // App name + project lookup
  const appNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of allApps) map.set(a.id, a.name);
    return map;
  }, [allApps]);
  const appProjectMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of allApps) map.set(a.id, a.project_id);
    return map;
  }, [allApps]);
  const appLatestVersionMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const a of allApps) map.set(a.id, a.latest_app_version ?? null);
    return map;
  }, [allApps]);
  const projectColorMap = useProjectColorMap(teamId);
  const appColorMap = useAppColorMap(teamId);

  // Column preferences
  const prefs = useUserPreferences();
  const updatePrefs = useUpdateUserPreferences();
  const columnOrder = prefs.ui?.columns?.events?.order ?? DEFAULT_EVENT_COLUMN_ORDER;
  const visibleColumns = useMemo(
    () => columnOrder.map((id) => EVENT_COLUMN_REGISTRY[id]).filter(Boolean),
    [columnOrder],
  );
  const pickerItems = useMemo(
    () => DEFAULT_EVENT_COLUMN_ORDER.map((id) => {
      const c = EVENT_COLUMN_REGISTRY[id];
      return { id: c.id, label: c.label, group: c.group };
    }),
    [],
  );
  const columnHelpers: EventColumnHelpers = useMemo(
    () => ({ appNameMap, appColorMap, appLatestVersionMap }),
    [appNameMap, appColorMap, appLatestVersionMap],
  );

  // Clear app filter if it doesn't belong to selected project
  useEffect(() => {
    if (projectId && appId) {
      const belongs = availableApps.some((a) => a.id === appId);
      if (!belongs) filters.set("app_id", "");
    }
  }, [projectId, appId, availableApps]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeRange = filters.get("time_range");
  const sinceInput = filters.get("since");
  const untilInput = filters.get("until");

  const chips = useMemo(() => {
    const c: FilterChip[] = [];
    if (projectId) c.push({ label: "Project", value: resolveEntityName(projects, projectId), onDismiss: () => filters.set("project_id", "") });
    if (appId) c.push({ label: "App", value: resolveEntityName(allApps, appId), onDismiss: () => filters.set("app_id", "") });
    if (timeRange) c.push({ label: "Time", value: formatTimeRangeChip(timeRange, sinceInput, untilInput), onDismiss: () => filters.setMany({ time_range: "", since: "", until: "" }) });
    if (level) c.push({ label: "Level", value: level, onDismiss: () => filters.set("level", "") });
    if (environment) c.push({ label: "Env", value: environment, onDismiss: () => filters.set("environment", "") });
    if (userId) c.push({ label: "User", value: truncateId(userId), onDismiss: () => filters.set("user_id", "") });
    if (sessionId) c.push({ label: "Session", value: truncateId(sessionId), onDismiss: () => filters.set("session_id", "") });
    if (screenName) c.push({ label: "Screen", value: screenName, onDismiss: () => filters.set("screen_name", "") });
    if (order === "asc") c.push({ label: "Sort", value: "Oldest first", onDismiss: () => filters.set("order", "") });
    return c;
  }, [projectId, appId, timeRange, sinceInput, untilInput, level, environment, userId, sessionId, screenName, order, projects, allApps, filters]);

  function handleRowClick(event: StoredEventResponse) {
    setSelectedEvent(event);
    filters.set("event_id", event.id);
  }

  function handleEventSelect(event: StoredEventResponse) {
    setSelectedEvent(event);
    filters.set("event_id", event.id);
  }

  function handleFilter(key: string, value: string) {
    filters.setMany({ [key]: value, event_id: "" });
  }

  function handleSheetOpenChange(open: boolean) {
    if (!open) filters.set("event_id", "");
  }

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
      {/* Filter bar */}
      <FilterSheet
        hasActiveFilters={filters.hasActiveFilters}
        onClear={filters.clearFilters}
        chips={chips}
        extraActions={
          <ColumnPicker
            allColumns={pickerItems}
            order={columnOrder}
            canReset={!isDefaultColumnOrder(columnOrder, DEFAULT_EVENT_COLUMN_ORDER)}
            onChange={(next) => updatePrefs({ ui: { columns: { events: { order: next } } } })}
            onReset={() => updatePrefs({ ui: { columns: { events: { order: DEFAULT_EVENT_COLUMN_ORDER } } } })}
          />
        }
      >
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Project</label>
          <Select
            value={projectId || "all"}
            onValueChange={(v) => filters.set("project_id", v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
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

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">App</label>
          <Select
            value={appId || "all"}
            onValueChange={(v) => filters.set("app_id", v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All apps</SelectItem>
              {availableApps.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex items-center gap-2">
                    <ProjectDot color={projectColorMap.get(a.project_id)} />
                    {a.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Time Range</label>
          <Select
            value={filters.get("time_range") || "all"}
            onValueChange={(v) => filters.handleTimeRangeChange(v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              {TIME_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filters.get("time_range") === "custom" && (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Since</label>
              <Input
                type="date"
                value={filters.get("since")}
                onChange={(e) => filters.handleDateChange("since", e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Until</label>
              <Input
                type="date"
                value={filters.get("until")}
                onChange={(e) => filters.handleDateChange("until", e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </>
        )}

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Level</label>
          <Select
            value={level || "all"}
            onValueChange={(v) => filters.set("level", v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              {LOG_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l === "info" ? "ℹ️ info" : l === "debug" ? "🐛 debug" : l === "warn" ? "⚠️ warn" : "🔴 error"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Environment</label>
          <Select
            value={environment || "all"}
            onValueChange={(v) => filters.set("environment", v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
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
          <label className="text-xs text-muted-foreground">User ID</label>
          <Input
            value={userId}
            onChange={(e) => filters.set("user_id", e.target.value)}
            placeholder="Filter by user"
            className="h-8 text-xs font-mono"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Session</label>
          <Input
            value={sessionId}
            onChange={(e) => filters.set("session_id", e.target.value)}
            placeholder="Filter by session"
            className="h-8 text-xs font-mono"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Screen</label>
          <Input
            value={screenName}
            onChange={(e) => filters.set("screen_name", e.target.value)}
            placeholder="Filter by screen"
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Sort</label>
          <Select
            value={order || "desc"}
            onValueChange={(v) => filters.set("order", v === "desc" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Newest first</SelectItem>
              <SelectItem value="asc">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterSheet>
      </StaggerItem>

      <StaggerItem index={1}>
      {/* Auto-refresh indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        Live — auto-refreshing every 10s
      </div>
      </StaggerItem>

      <StaggerItem index={2}>
      {/* Events table */}
      {isLoading ? (
        <TableSkeleton rows={10} columns={5} />
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No events found</p>
          {filters.hasActiveFilters && (
            <p className="text-xs mt-1">Try adjusting your filters</p>
          )}
        </div>
      ) : (
        <>
          <ConfigurableTable
            columns={visibleColumns}
            rows={events}
            helpers={columnHelpers}
            rowKey={(e) => e.id}
            onRowClick={handleRowClick}
            isRowSelected={(e) => e.id === selectedEvent?.id}
          />

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
      </StaggerItem>

      <EventDetailSheet
        event={selectedEvent}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        onEventSelect={handleEventSelect}
        onFilter={handleFilter}
        projectColor={selectedEvent ? appColorMap.get(selectedEvent.app_id) : undefined}
        latestAppVersion={selectedEvent ? appLatestVersionMap.get(selectedEvent.app_id) : undefined}
      />
    </AnimatedPage>
  );
}
