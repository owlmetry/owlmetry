"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import type {
  EventsQueryParams,
  StoredEventResponse,
  ProjectResponse,
  AppResponse,
  LogLevel,
} from "@owlmetry/shared";

const LOG_LEVELS: LogLevel[] = ["info", "debug", "warn", "error", "attention"];
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
  const searchParams = useSearchParams();
  const router = useRouter();

  // Filters from URL
  const [projectId, setProjectId] = useState(searchParams.get("project_id") ?? "");
  const [appId, setAppId] = useState(searchParams.get("app_id") ?? "");
  const [level, setLevel] = useState(searchParams.get("level") ?? "");
  const [userId, setUserId] = useState(searchParams.get("user_id") ?? "");
  const [screenName, setScreenName] = useState(searchParams.get("screen_name") ?? "");
  const [since, setSince] = useState(searchParams.get("since") ?? "");
  const [until, setUntil] = useState(searchParams.get("until") ?? "");
  const [includeDebug, setIncludeDebug] = useState(searchParams.get("include_debug") === "true");

  // Selected event for detail sheet
  const [selectedEvent, setSelectedEvent] = useState<StoredEventResponse | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Projects & apps for filter dropdowns
  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>("/v1/projects");
  const { data: appsData } = useSWR<{ apps: AppResponse[] }>("/v1/apps");

  const projects = projectsData?.projects ?? [];
  const allApps = appsData?.apps ?? [];

  // Derive available apps based on selected project
  const availableApps = projectId
    ? allApps.filter((a) => a.project_id === projectId)
    : allApps;

  // Build filter params
  const filters: EventsQueryParams = {};
  if (projectId) filters.project_id = projectId;
  if (appId) filters.app_id = appId;
  if (level) filters.level = level;
  if (userId) filters.user_id = userId;
  if (screenName) filters.screen_name = screenName;
  if (since) filters.since = new Date(since).toISOString();
  if (until) filters.until = new Date(until + "T23:59:59").toISOString();
  if (includeDebug) filters.include_debug = "true";

  const { events, isLoading, isLoadingMore, hasMore, loadMore } = useEvents(filters);

  // Sync filters to URL
  const updateUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (appId) params.set("app_id", appId);
    if (level) params.set("level", level);
    if (userId) params.set("user_id", userId);
    if (screenName) params.set("screen_name", screenName);
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    if (includeDebug) params.set("include_debug", "true");
    const qs = params.toString();
    router.replace(`/dashboard/events${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [projectId, appId, level, userId, screenName, since, until, includeDebug, router]);

  useEffect(() => {
    updateUrl();
  }, [updateUrl]);

  // Clear app filter if it doesn't belong to selected project
  useEffect(() => {
    if (projectId && appId) {
      const belongs = availableApps.some((a) => a.id === appId);
      if (!belongs) setAppId("");
    }
  }, [projectId, appId, availableApps]);

  function clearFilters() {
    setProjectId("");
    setAppId("");
    setLevel("");
    setUserId("");
    setScreenName("");
    setSince("");
    setUntil("");
    setIncludeDebug(false);
  }

  const hasFilters = projectId || appId || level || userId || screenName || since || until || includeDebug;

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
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
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
          <Select value={appId} onValueChange={setAppId}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
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
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">User ID</label>
          <Input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Filter by user"
            className="w-[160px] h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Screen</label>
          <Input
            value={screenName}
            onChange={(e) => setScreenName(e.target.value)}
            placeholder="Filter by screen"
            className="w-[160px] h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Since</label>
          <input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Until</label>
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-end">
          <label className="flex items-center gap-1.5 h-8 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeDebug}
              onChange={(e) => setIncludeDebug(e.target.checked)}
              className="rounded border-input"
            />
            Show debug events
          </label>
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
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
          {hasFilters && (
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
