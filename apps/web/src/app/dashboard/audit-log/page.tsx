"use client";

import { useState, useMemo } from "react";
import type { AuditLogsQueryParams, AuditLogResponse, AuditResourceType, AuditAction } from "@owlmetry/shared";
import { useAuditLogs } from "@/hooks/use-audit-logs";
import { useTeam } from "@/contexts/team-context";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { FilterSheet, type FilterChip, truncateId } from "@/components/filter-sheet";
import { formatTimeRangeChip } from "@/lib/time-ranges";
import { formatDateTime, formatCompactDateTime } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TIME_RANGES } from "@/lib/time-ranges";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { TableSkeleton } from "@/components/ui/skeletons";

// Mirrors AuditResourceType and AuditAction from @owlmetry/shared (runtime import
// would pull in node:crypto via the barrel export, which Next.js can't bundle)
const RESOURCE_TYPES: AuditResourceType[] = [
  "app", "project", "api_key", "team", "team_member",
  "invitation", "metric_definition", "user",
];
const ACTIONS: AuditAction[] = ["create", "update", "delete"];

function actionBadgeVariant(action: string) {
  switch (action) {
    case "create": return "default" as const;
    case "update": return "secondary" as const;
    case "delete": return "destructive" as const;
    default: return "outline" as const;
  }
}

export default function AuditLogPage() {
  const { currentTeam } = useTeam();

  const filters = useUrlFilters({
    path: "/dashboard/audit-log",
    defaults: {
      resource_type: "",
      action: "",
      resource_id: "",
      actor_id: "",
      time_range: "24h",
      since: "",
      until: "",
    },
  });

  const [selectedLog, setSelectedLog] = useState<AuditLogResponse | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const resourceType = filters.get("resource_type");
  const action = filters.get("action");
  const resourceId = filters.get("resource_id");
  const actorId = filters.get("actor_id");

  const queryFilters: AuditLogsQueryParams = {};
  if (resourceType) queryFilters.resource_type = resourceType;
  if (action) queryFilters.action = action;
  if (resourceId) queryFilters.resource_id = resourceId;
  if (actorId) queryFilters.actor_id = actorId;
  if (filters.computedSince) queryFilters.since = filters.computedSince;
  if (filters.computedUntil) queryFilters.until = filters.computedUntil;

  const { auditLogs, isLoading, isLoadingMore, hasMore, loadMore } = useAuditLogs(currentTeam?.id, queryFilters);

  const timeRange = filters.get("time_range");
  const sinceInput = filters.get("since");
  const untilInput = filters.get("until");

  const chips = useMemo(() => {
    const c: FilterChip[] = [];
    if (timeRange && timeRange !== "24h") c.push({ label: "Time", value: formatTimeRangeChip(timeRange, sinceInput, untilInput), onDismiss: () => filters.setMany({ time_range: "24h", since: "", until: "" }) });
    if (resourceType) c.push({ label: "Resource", value: resourceType.replace(/_/g, " "), onDismiss: () => filters.set("resource_type", "") });
    if (action) c.push({ label: "Action", value: action, onDismiss: () => filters.set("action", "") });
    if (resourceId) c.push({ label: "Resource ID", value: truncateId(resourceId), onDismiss: () => filters.set("resource_id", "") });
    if (actorId) c.push({ label: "Actor ID", value: truncateId(actorId), onDismiss: () => filters.set("actor_id", "") });
    return c;
  }, [timeRange, sinceInput, untilInput, resourceType, action, resourceId, actorId, filters]);

  function handleRowClick(log: AuditLogResponse) {
    setSelectedLog(log);
    setSheetOpen(true);
  }

  if (!currentTeam) {
    return <p className="text-sm text-muted-foreground">Loading team...</p>;
  }

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
      {/* Filter bar */}
      <FilterSheet
        hasActiveFilters={filters.hasActiveFilters}
        onClear={filters.clearFilters}
        chips={chips}
      >
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Time Range</label>
          <Select value={filters.get("time_range")} onValueChange={filters.handleTimeRangeChange}>
            <SelectTrigger className="h-8 text-xs">
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
          <label className="text-xs text-muted-foreground">Resource Type</label>
          <Select
            value={resourceType || "all"}
            onValueChange={(v) => filters.set("resource_type", v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {RESOURCE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Action</label>
          <Select
            value={action || "all"}
            onValueChange={(v) => filters.set("action", v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a === "create" ? "✨ create" : a === "update" ? "✏️ update" : "🗑️ delete"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Resource ID</label>
          <Input
            value={resourceId}
            onChange={(e) => filters.set("resource_id", e.target.value)}
            placeholder="Filter by resource ID"
            className="h-8 text-xs font-mono"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Actor ID</label>
          <Input
            value={actorId}
            onChange={(e) => filters.set("actor_id", e.target.value)}
            placeholder="Filter by actor ID"
            className="h-8 text-xs font-mono"
          />
        </div>
      </FilterSheet>
      </StaggerItem>

      <StaggerItem index={1}>
      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={10} columns={5} />
      ) : auditLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No audit logs found</p>
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
                  <TableHead className="w-[160px]">Time</TableHead>
                  <TableHead className="w-[90px]">Action</TableHead>
                  <TableHead className="w-[140px]">Resource Type</TableHead>
                  <TableHead className="w-[90px]">Actor</TableHead>
                  <TableHead>Resource ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.map((log) => {
                  const ts = new Date(log.timestamp);
                  const time = formatCompactDateTime(ts);

                  return (
                    <TableRow
                      key={log.id}
                      onClick={() => handleRowClick(log)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-mono text-xs py-1.5">
                        {time}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Badge variant={actionBadgeVariant(log.action)} className="text-xs">
                          {log.action === "create" ? "✨ create" : log.action === "update" ? "✏️ update" : "🗑️ delete"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs py-1.5">
                        {log.resource_type.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell className="text-xs py-1.5">
                        {log.actor_type}
                      </TableCell>
                      <TableCell className="font-mono text-xs py-1.5 truncate max-w-[200px]">
                        {log.resource_id}
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
      </StaggerItem>

      {/* Detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Audit Log Detail</SheetTitle>
          </SheetHeader>
          {selectedLog && (
            <div className="mt-4 space-y-4 text-sm">
              <div className="grid grid-cols-[100px_1fr] gap-y-2 gap-x-3">
                <span className="text-muted-foreground">Time</span>
                <span className="font-mono text-xs">{formatDateTime(selectedLog.timestamp)}</span>

                <span className="text-muted-foreground">Action</span>
                <Badge variant={actionBadgeVariant(selectedLog.action)} className="w-fit text-xs">
                  {selectedLog.action === "create" ? "✨ create" : selectedLog.action === "update" ? "✏️ update" : "🗑️ delete"}
                </Badge>

                <span className="text-muted-foreground">Resource</span>
                <span>{selectedLog.resource_type.replace(/_/g, " ")}</span>

                <span className="text-muted-foreground">Resource ID</span>
                <span className="font-mono text-xs break-all">{selectedLog.resource_id}</span>

                <span className="text-muted-foreground">Actor Type</span>
                <span>{selectedLog.actor_type}</span>

                <span className="text-muted-foreground">Actor ID</span>
                <span className="font-mono text-xs break-all">{selectedLog.actor_id}</span>
              </div>

              {selectedLog.changes && Object.keys(selectedLog.changes).length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">Changes</h4>
                  <div className="rounded-md border p-3 space-y-2">
                    {Object.entries(selectedLog.changes).map(([field, change]) => (
                      <div key={field} className="text-xs">
                        <span className="font-medium">{field}</span>
                        <div className="ml-2 mt-0.5 font-mono">
                          {change.before !== undefined && (
                            <div className="text-red-400">- {JSON.stringify(change.before)}</div>
                          )}
                          {change.after !== undefined && (
                            <div className="text-green-400">+ {JSON.stringify(change.after)}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">Metadata</h4>
                  <pre className="rounded-md border p-3 text-xs font-mono whitespace-pre-wrap break-all">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AnimatedPage>
  );
}
