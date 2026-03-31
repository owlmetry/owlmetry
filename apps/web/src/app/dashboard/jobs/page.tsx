"use client";

import { useState, useMemo } from "react";
// Deep imports bypass the barrel export which pulls in node:crypto
import type { JobRunResponse, JobRunsQueryParams, TriggerJobRequest, JobType } from "@owlmetry/shared";
import { JOB_TYPE_META } from "@owlmetry/shared/jobs";
import { formatDuration as formatMs } from "@owlmetry/shared/constants";

type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

function getJobLabel(jobType: string): string {
  return JOB_TYPE_META[jobType as JobType]?.label ?? jobType;
}

function getJobScope(jobType: string): string | undefined {
  return JOB_TYPE_META[jobType as JobType]?.scope;
}
import { useJobRuns } from "@/hooks/use-jobs";
import { useTeam } from "@/contexts/team-context";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { FilterSheet, type FilterChip, truncateId } from "@/components/filter-sheet";
import { formatTimeRangeChip } from "@/lib/time-ranges";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { TIME_RANGES } from "@/lib/time-ranges";

const PROJECT_JOB_TYPES = Object.entries(JOB_TYPE_META)
  .filter(([, meta]) => meta.scope === "project");

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="default" className="bg-green-600 text-xs">completed</Badge>;
    case "failed":
      return <Badge variant="destructive" className="text-xs">failed</Badge>;
    case "running":
      return <Badge variant="default" className="bg-blue-600 text-xs animate-pulse">running</Badge>;
    case "cancelled":
      return <Badge variant="secondary" className="text-xs">cancelled</Badge>;
    case "pending":
      return <Badge variant="outline" className="text-xs">pending</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  return formatMs(end - start);
}

function formatTriggeredBy(triggeredBy: string): string {
  if (triggeredBy === "schedule") return "schedule";
  if (triggeredBy === "system") return "system";
  if (triggeredBy.startsWith("manual:user:")) return "user";
  if (triggeredBy.startsWith("manual:api_key:")) return "agent";
  return triggeredBy;
}

export default function JobsPage() {
  const { currentTeam } = useTeam();

  const filters = useUrlFilters({
    path: "/dashboard/jobs",
    defaults: {
      job_type: "",
      status: "",
      time_range: "24h",
      since: "",
      until: "",
    },
  });

  const [selectedRun, setSelectedRun] = useState<JobRunResponse | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerType, setTriggerType] = useState("");
  const [triggerProjectId, setTriggerProjectId] = useState("");
  const [triggerNotify, setTriggerNotify] = useState(false);
  const [triggerError, setTriggerError] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const jobType = filters.get("job_type");
  const status = filters.get("status");

  const queryFilters: Partial<JobRunsQueryParams> = {};
  if (jobType) queryFilters.job_type = jobType;
  if (status) queryFilters.status = status;
  if (filters.computedSince) queryFilters.since = filters.computedSince;
  if (filters.computedUntil) queryFilters.until = filters.computedUntil;

  const { jobRuns, isLoading, isLoadingMore, hasMore, loadMore, mutate } = useJobRuns(
    currentTeam?.id,
    queryFilters,
  );

  const timeRange = filters.get("time_range");
  const sinceInput = filters.get("since");
  const untilInput = filters.get("until");

  const chips = useMemo(() => {
    const c: FilterChip[] = [];
    if (timeRange && timeRange !== "24h") {
      c.push({
        label: "Time",
        value: formatTimeRangeChip(timeRange, sinceInput, untilInput),
        onDismiss: () => filters.setMany({ time_range: "24h", since: "", until: "" }),
      });
    }
    if (jobType) {
      c.push({
        label: "Type",
        value: getJobLabel(jobType),
        onDismiss: () => filters.set("job_type", ""),
      });
    }
    if (status) {
      c.push({ label: "Status", value: status, onDismiss: () => filters.set("status", "") });
    }
    return c;
  }, [timeRange, sinceInput, untilInput, jobType, status, filters]);

  async function handleTrigger(e: React.FormEvent) {
    e.preventDefault();
    if (!currentTeam || !triggerType) return;
    setTriggering(true);
    setTriggerError("");

    try {
      const body: TriggerJobRequest = {
        job_type: triggerType,
        notify: triggerNotify,
      };
      if (triggerProjectId) body.project_id = triggerProjectId;

      await api.post(`/v1/teams/${currentTeam.id}/jobs/trigger`, body);
      setTriggerOpen(false);
      setTriggerType("");
      setTriggerProjectId("");
      setTriggerNotify(false);
      mutate();
    } catch (err) {
      setTriggerError(err instanceof ApiError ? err.message : "Failed to trigger job");
    } finally {
      setTriggering(false);
    }
  }

  async function handleCancel(runId: string) {
    setCancelling(true);
    try {
      await api.post(`/v1/jobs/${runId}/cancel`);
      mutate();
      setSheetOpen(false);
    } catch {
      // ignore
    } finally {
      setCancelling(false);
    }
  }

  if (!currentTeam) {
    return <p className="text-sm text-muted-foreground">Loading team...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Header with trigger button */}
      <div className="flex items-center justify-between">
        <div />
        <Dialog open={triggerOpen} onOpenChange={setTriggerOpen}>
          <DialogTrigger asChild>
            <Button size="sm">Run Job</Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleTrigger}>
              <DialogHeader>
                <DialogTitle>Run a Job</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Job Type</Label>
                  <Select value={triggerType} onValueChange={setTriggerType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select job type" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_JOB_TYPES.map(([type, meta]) => (
                        <SelectItem key={type} value={type}>
                          {meta.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {triggerType && getJobScope(triggerType) === "project" && (
                  <div className="space-y-2">
                    <Label>Project ID</Label>
                    <Input
                      value={triggerProjectId}
                      onChange={(e) => setTriggerProjectId(e.target.value)}
                      placeholder="Enter project ID"
                      className="font-mono text-sm"
                    />
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="notify"
                    checked={triggerNotify}
                    onCheckedChange={(checked) => setTriggerNotify(checked === true)}
                  />
                  <Label htmlFor="notify" className="text-sm font-normal">
                    Notify me when done
                  </Label>
                </div>

                {triggerError && (
                  <p className="text-sm text-destructive">{triggerError}</p>
                )}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={triggering || !triggerType}>
                  {triggering ? "Triggering..." : "Run"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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
          <label className="text-xs text-muted-foreground">Job Type</label>
          <Select value={jobType} onValueChange={(v) => filters.set("job_type", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_JOB_TYPES.map(([type, meta]) => (
                <SelectItem key={type} value={type}>
                  {meta.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={status} onValueChange={(v) => filters.set("status", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              {(["pending", "running", "completed", "failed", "cancelled"] as JobStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </FilterSheet>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading jobs...</p>
      ) : jobRuns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No job runs found</p>
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
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[180px]">Type</TableHead>
                  <TableHead className="w-[100px]">Triggered</TableHead>
                  <TableHead className="w-[100px]">Duration</TableHead>
                  <TableHead className="w-[140px]">Progress</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobRuns.map((run) => {
                  const label = getJobLabel(run.job_type);
                  const ts = new Date(run.created_at);
                  const time = ts.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  });

                  const progressPct = run.progress?.total
                    ? Math.round((run.progress.processed / run.progress.total) * 100)
                    : null;

                  return (
                    <TableRow
                      key={run.id}
                      onClick={() => { setSelectedRun(run); setSheetOpen(true); }}
                      className="cursor-pointer"
                    >
                      <TableCell className="py-1.5">{statusBadge(run.status)}</TableCell>
                      <TableCell className="text-xs py-1.5">{label}</TableCell>
                      <TableCell className="text-xs py-1.5">{formatTriggeredBy(run.triggered_by)}</TableCell>
                      <TableCell className="text-xs py-1.5 font-mono">
                        {formatDuration(run.started_at, run.completed_at)}
                      </TableCell>
                      <TableCell className="py-1.5">
                        {progressPct !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${progressPct}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{progressPct}%</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs py-1.5">{time}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
          <SheetHeader className="px-6 pt-6 pb-4">
            <SheetTitle>Job Run Detail</SheetTitle>
          </SheetHeader>
          {selectedRun && (
            <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4 text-sm">
              <div className="grid grid-cols-[100px_1fr] gap-y-2 gap-x-3">
                <span className="text-muted-foreground">Type</span>
                <span>{getJobLabel(selectedRun.job_type)}</span>

                <span className="text-muted-foreground">Status</span>
                <span>{statusBadge(selectedRun.status)}</span>

                <span className="text-muted-foreground">Triggered</span>
                <span>{selectedRun.triggered_by}</span>

                <span className="text-muted-foreground">Duration</span>
                <span className="font-mono text-xs">
                  {formatDuration(selectedRun.started_at, selectedRun.completed_at)}
                </span>

                <span className="text-muted-foreground">Created</span>
                <span className="font-mono text-xs">{new Date(selectedRun.created_at).toLocaleString()}</span>

                {selectedRun.started_at && (
                  <>
                    <span className="text-muted-foreground">Started</span>
                    <span className="font-mono text-xs">{new Date(selectedRun.started_at).toLocaleString()}</span>
                  </>
                )}

                {selectedRun.completed_at && (
                  <>
                    <span className="text-muted-foreground">Completed</span>
                    <span className="font-mono text-xs">{new Date(selectedRun.completed_at).toLocaleString()}</span>
                  </>
                )}

                <span className="text-muted-foreground">ID</span>
                <span className="font-mono text-xs break-all">{selectedRun.id}</span>
              </div>

              {selectedRun.progress && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">Progress</h4>
                  <div className="space-y-1">
                    <div className="h-3 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{
                          width: `${selectedRun.progress.total > 0
                            ? (selectedRun.progress.processed / selectedRun.progress.total) * 100
                            : 0}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedRun.progress.processed}/{selectedRun.progress.total}
                      {selectedRun.progress.message && ` — ${selectedRun.progress.message}`}
                    </p>
                  </div>
                </div>
              )}

              {selectedRun.error && (
                <div>
                  <h4 className="text-xs font-medium text-destructive mb-2">Error</h4>
                  <pre className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                    {selectedRun.error}
                  </pre>
                </div>
              )}

              {selectedRun.result && Object.keys(selectedRun.result).length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">Result</h4>
                  <pre className="rounded-md border p-3 text-xs font-mono whitespace-pre-wrap break-all">
                    {JSON.stringify(selectedRun.result, null, 2)}
                  </pre>
                </div>
              )}

              {selectedRun.params && Object.keys(selectedRun.params).length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">Parameters</h4>
                  <pre className="rounded-md border p-3 text-xs font-mono whitespace-pre-wrap break-all">
                    {JSON.stringify(selectedRun.params, null, 2)}
                  </pre>
                </div>
              )}

              {selectedRun.status === "running" && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={cancelling}
                  onClick={() => handleCancel(selectedRun.id)}
                >
                  {cancelling ? "Cancelling..." : "Cancel Job"}
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
