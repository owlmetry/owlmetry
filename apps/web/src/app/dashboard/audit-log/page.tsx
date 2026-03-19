"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { AuditLogsQueryParams, AuditLogResponse, AuditResourceType, AuditAction } from "@owlmetry/shared";
import { useAuditLogs } from "@/hooks/use-audit-logs";
import { useTeam } from "@/contexts/team-context";
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
import { X } from "lucide-react";

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
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentTeam } = useTeam();

  const [resourceType, setResourceType] = useState(searchParams.get("resource_type") ?? "");
  const [action, setAction] = useState(searchParams.get("action") ?? "");
  const [since, setSince] = useState(searchParams.get("since") ?? "");
  const [until, setUntil] = useState(searchParams.get("until") ?? "");

  const [selectedLog, setSelectedLog] = useState<AuditLogResponse | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const filters: AuditLogsQueryParams = {
    team_id: currentTeam?.id ?? "",
  };
  if (resourceType) filters.resource_type = resourceType;
  if (action) filters.action = action;
  if (since) filters.since = new Date(since).toISOString();
  if (until) filters.until = new Date(until + "T23:59:59").toISOString();

  const { auditLogs, isLoading, isLoadingMore, hasMore, loadMore } = useAuditLogs(filters);

  const updateUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (resourceType) params.set("resource_type", resourceType);
    if (action) params.set("action", action);
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    const qs = params.toString();
    router.replace(`/dashboard/audit-log${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [resourceType, action, since, until, router]);

  useEffect(() => {
    updateUrl();
  }, [updateUrl]);

  function clearFilters() {
    setResourceType("");
    setAction("");
    setSince("");
    setUntil("");
  }

  const hasFilters = resourceType || action || since || until;

  function handleRowClick(log: AuditLogResponse) {
    setSelectedLog(log);
    setSheetOpen(true);
  }

  if (!currentTeam) {
    return <p className="text-sm text-muted-foreground">Loading team...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Resource Type</label>
          <Select value={resourceType} onValueChange={setResourceType}>
            <SelectTrigger size="sm" className="w-[180px] text-xs">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
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
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger size="sm" className="w-[130px] text-xs">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
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
            onChange={(e) => setSince(e.target.value)}
            className="w-[150px] h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Until</label>
          <Input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="w-[150px] h-8 text-xs"
          />
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading audit logs...</p>
      ) : auditLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No audit logs found</p>
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
                  const time = ts.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  });

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
                          {log.action}
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
                <span className="font-mono text-xs">{new Date(selectedLog.timestamp).toLocaleString()}</span>

                <span className="text-muted-foreground">Action</span>
                <Badge variant={actionBadgeVariant(selectedLog.action)} className="w-fit text-xs">
                  {selectedLog.action}
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
    </div>
  );
}
