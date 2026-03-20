"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import type {
  EventsQueryParams,
  StoredEventResponse,
  ProjectResponse,
  AppResponse,
  LogLevel,
} from "@owlmetry/shared";
import { ENVIRONMENTS } from "@/lib/time-ranges";

const LOG_LEVELS: LogLevel[] = ["info", "debug", "warn", "error"];
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useEvents } from "@/hooks/use-events";
import { EventLevelBadge } from "@/components/event-level-badge";
import { EventDetailSheet } from "@/components/event-detail-sheet";
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
import { X } from "lucide-react";

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
      since: "",
      until: "",
    },
  });

  // Selected event for detail sheet
  const [selectedEvent, setSelectedEvent] = useState<StoredEventResponse | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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
  const since = filters.get("since");
  if (since) filterParams.since = new Date(since).toISOString();
  const until = filters.get("until");
  if (until) filterParams.until = new Date(until + "T23:59:59").toISOString();
  filterParams.data_mode = dataMode;

  const { events, isLoading, isLoadingMore, hasMore, loadMore } = useEvents(filterParams);

  // Clear app filter if it doesn't belong to selected project
  useEffect(() => {
    if (projectId && appId) {
      const belongs = availableApps.some((a) => a.id === appId);
      if (!belongs) filters.set("app_id", "");
    }
  }, [projectId, appId, availableApps]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRowClick(event: StoredEventResponse) {
    setSelectedEvent(event);
    setSheetOpen(true);
  }

  function handleEventSelect(event: StoredEventResponse) {
    setSelectedEvent(event);
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Project</label>
          <Select value={projectId} onValueChange={(v) => filters.set("project_id", v)}>
            <SelectTrigger size="sm" className="w-[180px] text-xs">
              <SelectValue placeholder="All projects" />
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
          <Select value={appId} onValueChange={(v) => filters.set("app_id", v)}>
            <SelectTrigger size="sm" className="w-[180px] text-xs">
              <SelectValue placeholder="All apps" />
            </SelectTrigger>
            <SelectContent>
              {availableApps.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Level</label>
          <Select value={level} onValueChange={(v) => filters.set("level", v)}>
            <SelectTrigger size="sm" className="w-[130px] text-xs">
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l === "info" ? "ℹ️ info" : l === "debug" ? "🐛 debug" : l === "warn" ? "⚠️ warn" : "🔴 error"}
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
            className="w-[160px] h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Screen</label>
          <Input
            value={screenName}
            onChange={(e) => filters.set("screen_name", e.target.value)}
            placeholder="Filter by screen"
            className="w-[160px] h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Session</label>
          <Input
            value={sessionId}
            onChange={(e) => filters.set("session_id", e.target.value)}
            placeholder="Filter by session"
            className="w-[160px] h-8 text-xs font-mono"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Environment</label>
          <Select
            value={environment || "all"}
            onValueChange={(v) => filters.set("environment", v === "all" ? "" : v)}
          >
            <SelectTrigger size="sm" className="w-[130px] text-xs">
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
          <label className="text-xs text-muted-foreground">Since</label>
          <Input
            type="date"
            value={since}
            onChange={(e) => filters.set("since", e.target.value)}
            className="w-[150px] h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Until</label>
          <Input
            type="date"
            value={until}
            onChange={(e) => filters.set("until", e.target.value)}
            className="w-[150px] h-8 text-xs"
          />
        </div>

        {filters.hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={filters.clearFilters} className="h-8">
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Auto-refresh indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        Live — auto-refreshing every 10s
      </div>

      {/* Events table */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading events...</p>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No events found</p>
          {filters.hasActiveFilters && (
            <p className="text-xs mt-1">Try adjusting your filters</p>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Time</TableHead>
                  <TableHead className="w-[90px]">Level</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="w-[140px]">User ID</TableHead>
                  <TableHead className="w-[120px]">Screen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const ts = new Date(event.timestamp);
                  const time = ts.toLocaleTimeString("en-US", { hour12: false });
                  const fullDate = ts.toLocaleString();
                  const isSelected = selectedEvent?.id === event.id;

                  return (
                    <TableRow
                      key={event.id}
                      onClick={() => handleRowClick(event)}
                      className={`cursor-pointer ${isSelected ? "bg-muted/50" : ""}`}
                    >
                      <TableCell
                        className="font-mono text-xs py-1.5"
                        title={fullDate}
                      >
                        {time}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <EventLevelBadge level={event.level as LogLevel} />
                      </TableCell>
                      <TableCell className="font-mono text-xs py-1.5 max-w-[400px] truncate">
                        {event.message}
                      </TableCell>
                      <TableCell className="font-mono text-xs py-1.5 truncate max-w-[140px]">
                        {event.user_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs py-1.5 truncate max-w-[120px]">
                        {event.screen_name ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

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

      <EventDetailSheet
        event={selectedEvent}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onEventSelect={handleEventSelect}
      />
    </div>
  );
}
