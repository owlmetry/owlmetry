"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type {
  TeamAppUsersQueryParams,
  ProjectResponse,
  AppResponse,
  AppUserResponse,
} from "@owlmetry/shared";
import {
  BILLING_TIERS,
  isBillingFilterActive,
  parseBillingTiers,
  serializeBillingTiers,
  type BillingTier,
} from "@owlmetry/shared/billing";
import { UserDetailSheet } from "@/components/user-detail-sheet";
import { TIME_RANGES } from "@/lib/time-ranges";
import { FilterSheet, type FilterChip, resolveEntityName, truncateId } from "@/components/filter-sheet";
import { formatTimeRangeChip } from "@/lib/time-ranges";
import { useTeam } from "@/contexts/team-context";
import { formatDateTime } from "@/lib/format-date";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useTeamAppUsers } from "@/hooks/use-team-app-users";
import { useProjectColorMap, useAppColorMap } from "@/hooks/use-project-colors";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProjectDot } from "@/lib/project-color";

const BILLING_TIER_LABELS: Record<BillingTier, string> = {
  paid: "💰 Paid",
  trial: "🎁 Trial",
  free: "🆓 Free",
};

export default function UsersPage() {
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id;

  const filters = useUrlFilters({
    path: "/dashboard/users",
    defaults: {
      project_id: "",
      app_id: "",
      search: "",
      is_anonymous: "",
      billing_status: "",
      time_range: "",
      since: "",
      until: "",
    },
  });

  // Projects & apps for filter dropdowns
  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null
  );
  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    teamId ? `/v1/apps?team_id=${teamId}` : null
  );

  const projects = projectsData?.projects ?? [];
  const allApps = appsData?.apps ?? [];
  const appProjectMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of allApps) m.set(a.id, a.project_id);
    return m;
  }, [allApps]);
  const projectColorMap = useProjectColorMap(teamId);
  const appColorMap = useAppColorMap(teamId);

  const projectId = filters.get("project_id");
  const appId = filters.get("app_id");

  const availableApps = projectId
    ? allApps.filter((a) => a.project_id === projectId)
    : allApps;

  // Build filter params
  const filterParams: TeamAppUsersQueryParams = {};
  if (teamId) filterParams.team_id = teamId;
  if (projectId) filterParams.project_id = projectId;
  if (appId) filterParams.app_id = appId;
  const search = filters.get("search");
  if (search) filterParams.search = search;
  const isAnonymous = filters.get("is_anonymous");
  if (isAnonymous) filterParams.is_anonymous = isAnonymous;
  const billingStatusRaw = filters.get("billing_status");
  const billingTiers = useMemo(() => parseBillingTiers(billingStatusRaw), [billingStatusRaw]);
  if (isBillingFilterActive(billingTiers)) {
    filterParams.billing_status = serializeBillingTiers(billingTiers);
  }
  if (filters.computedSince) filterParams.since = filters.computedSince;
  if (filters.computedUntil) filterParams.until = filters.computedUntil;

  const { users, isLoading, isLoadingMore, hasMore, loadMore } = useTeamAppUsers(filterParams);

  const [selectedUser, setSelectedUser] = useState<AppUserResponse | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function handleRowClick(user: AppUserResponse) {
    setSelectedUser(user);
    setSheetOpen(true);
  }

  function handleSheetFilter(key: string, value: string) {
    filters.set(key, value);
    setSheetOpen(false);
  }

  function toggleBillingTier(tier: BillingTier, checked: boolean) {
    const next = new Set(billingTiers);
    if (checked) next.add(tier);
    else next.delete(tier);
    filters.set("billing_status", serializeBillingTiers(next));
  }

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
    if (isAnonymous) c.push({ label: "Type", value: isAnonymous === "true" ? "Anonymous" : "Real", onDismiss: () => filters.set("is_anonymous", "") });
    if (isBillingFilterActive(billingTiers)) {
      c.push({
        label: "Billing",
        value: BILLING_TIERS.filter((t) => billingTiers.has(t)).map((t) => BILLING_TIER_LABELS[t]).join(", "),
        onDismiss: () => filters.set("billing_status", ""),
      });
    }
    if (search) c.push({ label: "Search", value: truncateId(search), onDismiss: () => filters.set("search", "") });
    return c;
  }, [projectId, appId, timeRange, sinceInput, untilInput, isAnonymous, billingTiers, search, projects, allApps, filters]);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <FilterSheet
        hasActiveFilters={filters.hasActiveFilters}
        onClear={filters.clearFilters}
        chips={chips}
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
          <label className="text-xs text-muted-foreground">Type</label>
          <Select
            value={isAnonymous || "all"}
            onValueChange={(v) => filters.set("is_anonymous", v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All users</SelectItem>
              <SelectItem value="false">👤 Real users</SelectItem>
              <SelectItem value="true">👻 Anonymous</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Billing</label>
          <div className="flex flex-col gap-2 pt-1">
            {BILLING_TIERS.map((tier) => (
              <label key={tier} className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox
                  checked={billingTiers.has(tier)}
                  onCheckedChange={(c) => toggleBillingTier(tier, c === true)}
                />
                <span>{BILLING_TIER_LABELS[tier]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Search</label>
          <Input
            value={search}
            onChange={(e) => filters.set("search", e.target.value)}
            placeholder="Search user IDs..."
            className="h-8 text-xs font-mono"
          />
        </div>
      </FilterSheet>

      {/* Auto-refresh indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        Auto-refreshing every 30s
      </div>

      {/* Users table */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading users...</p>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No users found</p>
          {filters.hasActiveFilters ? (
            <p className="text-xs mt-1">Try adjusting your filters</p>
          ) : (
            <p className="text-xs mt-1">Users appear here after events are ingested</p>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User ID</TableHead>
                  <TableHead className="w-[100px]">Type</TableHead>
                  <TableHead className="w-[180px]">Apps</TableHead>
                  <TableHead className="w-[80px]">Claims</TableHead>
                  <TableHead className="w-[200px]">Properties</TableHead>
                  <TableHead className="w-[160px]">First Seen</TableHead>
                  <TableHead className="w-[160px]">Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleRowClick(user)}>
                    <TableCell className="font-mono text-xs py-1.5">
                      {user.user_id}
                    </TableCell>
                    <TableCell className="py-1.5">
                      {user.is_anonymous ? (
                        <Badge variant="secondary" className="text-xs">👻 anon</Badge>
                      ) : (
                        <Badge variant="default" className="text-xs">👤 real</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs py-1.5 max-w-[180px]">
                      <div className="flex flex-wrap gap-1">
                        {user.apps && user.apps.length > 0 ? (
                          user.apps.map((a) => (
                            <Badge
                              key={a.app_id}
                              variant="outline"
                              className="text-xs cursor-pointer hover:bg-accent flex items-center gap-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                filters.set("app_id", a.app_id);
                              }}
                            >
                              <ProjectDot color={appColorMap.get(a.app_id)} size={6} />
                              {a.app_name}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs py-1.5">
                      {user.claimed_from?.length ?? 0}
                    </TableCell>
                    <TableCell className="py-1.5">
                      {user.properties ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {user.properties.rc_period_type === "trial" ? (
                            <Badge variant="default" className="text-xs bg-sky-600">🎁 Trial</Badge>
                          ) : user.properties.rc_subscriber === "true" ? (
                            <Badge variant="default" className="text-xs bg-green-600">💰 Paid</Badge>
                          ) : null}
                          {user.properties.rc_status === "cancelled" && (
                            <Badge variant="secondary" className="text-xs">Cancelled</Badge>
                          )}
                          {user.properties.rc_last_purchase && (
                            <span className="text-xs text-muted-foreground">
                              {user.properties.rc_last_purchase}
                              {user.properties.rc_billing_period && (
                                <> · {user.properties.rc_billing_period.replace(/_/g, " ")}</>
                              )}
                            </span>
                          )}
                          {Object.entries(user.properties)
                            .filter(([k]) => !k.startsWith("rc_"))
                            .slice(0, 3)
                            .map(([k, v]) => (
                              <Badge key={k} variant="outline" className="text-xs">
                                {k}: {v}
                              </Badge>
                            ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs py-1.5" title={user.first_seen_at}>
                      {formatDateTime(user.first_seen_at)}
                    </TableCell>
                    <TableCell className="text-xs py-1.5" title={user.last_seen_at}>
                      {formatDateTime(user.last_seen_at)}
                    </TableCell>
                  </TableRow>
                ))}
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

      <UserDetailSheet
        user={selectedUser}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onFilter={handleSheetFilter}
        projectColorMap={projectColorMap}
        appColorMap={appColorMap}
      />
    </div>
  );
}
