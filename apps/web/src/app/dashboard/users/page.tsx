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
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useTeamAppUsers } from "@/hooks/use-team-app-users";
import { isDefaultColumnOrder } from "@owlmetry/shared/preferences";
import { useUserPreferences, useUpdateUserPreferences } from "@/hooks/use-user-preferences";
import { useProjectColorMap, useAppColorMap, useProjectInfoMap } from "@/hooks/use-project-colors";
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
import { ProjectDot } from "@/lib/project-color";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { TableSkeleton } from "@/components/ui/skeletons";
import { ConfigurableTable } from "@/components/configurable-table";
import { ColumnPicker } from "@/components/column-picker";
import {
  USER_COLUMN_REGISTRY,
  DEFAULT_USER_COLUMN_ORDER,
  type UserColumnHelpers,
} from "@/lib/user-columns";

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
      app_user_id: "",
      sort: "first_seen",
    },
    persistKeys: ["app_user_id", "sort"],
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
  const appLatestVersionMap = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of allApps) m.set(a.id, a.latest_app_version ?? null);
    return m;
  }, [allApps]);
  const projectColorMap = useProjectColorMap(teamId);
  const appColorMap = useAppColorMap(teamId);
  const projectInfoMap = useProjectInfoMap(teamId);

  // Column preferences
  const prefs = useUserPreferences();
  const updatePrefs = useUpdateUserPreferences();
  const columnOrder = prefs.ui?.columns?.users?.order ?? DEFAULT_USER_COLUMN_ORDER;
  const visibleColumns = useMemo(
    () => columnOrder.map((id) => USER_COLUMN_REGISTRY[id]).filter(Boolean),
    [columnOrder],
  );
  const pickerItems = useMemo(
    () => Object.values(USER_COLUMN_REGISTRY).map((c) => ({ id: c.id, label: c.label, group: c.group })),
    [],
  );

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
  const sort = filters.get("sort") === "last_seen" ? "last_seen" : "first_seen";
  filterParams.sort = sort;

  const { users, isLoading, isLoadingMore, hasMore, loadMore } = useTeamAppUsers(filterParams);

  const [selectedUser, setSelectedUser] = useState<AppUserResponse | null>(null);
  const appUserIdParam = filters.get("app_user_id");
  const sheetOpen = !!appUserIdParam;

  // Resolve selectedUser from URL app_user_id: prefer loaded list, fall back to fetching by id
  const userInList = useMemo(
    () => (appUserIdParam ? users.find((u) => u.id === appUserIdParam) ?? null : null),
    [appUserIdParam, users],
  );
  const { data: fetchedUser } = useSWR<AppUserResponse>(
    appUserIdParam && !userInList ? `/v1/app-users/${appUserIdParam}` : null,
  );
  useEffect(() => {
    if (!appUserIdParam) {
      setSelectedUser(null);
      return;
    }
    if (userInList) {
      setSelectedUser(userInList);
    } else if (fetchedUser && fetchedUser.id === appUserIdParam) {
      setSelectedUser(fetchedUser);
    }
  }, [appUserIdParam, userInList, fetchedUser]);

  function handleRowClick(user: AppUserResponse) {
    setSelectedUser(user);
    filters.set("app_user_id", user.id);
  }

  function handleSheetFilter(key: string, value: string) {
    filters.setMany({ [key]: value, app_user_id: "" });
  }

  const columnHelpers: UserColumnHelpers = useMemo(
    () => ({
      appColorMap,
      appLatestVersionMap,
      projectInfoMap,
      onFilterClick: (key, value) => filters.set(key, value),
    }),
    [appColorMap, appLatestVersionMap, projectInfoMap, filters],
  );

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
            canReset={!isDefaultColumnOrder(columnOrder, DEFAULT_USER_COLUMN_ORDER)}
            onChange={(next) => updatePrefs({ ui: { columns: { users: { order: next } } } })}
            onReset={() => updatePrefs({ ui: { columns: { users: { order: DEFAULT_USER_COLUMN_ORDER } } } })}
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
      </StaggerItem>

      <StaggerItem index={1}>
      {/* Sort + auto-refresh */}
      <div className="flex items-center justify-between gap-2">
        <Select
          value={sort}
          onValueChange={(v) => filters.set("sort", v)}
        >
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="first_seen">Newest first seen</SelectItem>
            <SelectItem value="last_seen">Most recently seen</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Auto-refreshing every 30s
        </div>
      </div>
      </StaggerItem>

      <StaggerItem index={2}>
      {/* Users table */}
      {isLoading ? (
        <TableSkeleton rows={10} columns={6} />
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
          <ConfigurableTable
            columns={visibleColumns}
            rows={users}
            helpers={columnHelpers}
            rowKey={(u) => u.id}
            onRowClick={handleRowClick}
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

      <UserDetailSheet
        user={selectedUser}
        open={sheetOpen}
        onOpenChange={(v) => { if (!v) filters.set("app_user_id", ""); }}
        onFilter={handleSheetFilter}
        projectColorMap={projectColorMap}
        appColorMap={appColorMap}
        appLatestVersionMap={appLatestVersionMap}
      />
    </AnimatedPage>
  );
}
