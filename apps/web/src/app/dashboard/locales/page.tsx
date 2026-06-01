"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Globe } from "lucide-react";
import type {
  ProjectResponse,
  AppResponse,
  UserLocalesResponse,
} from "@owlmetry/shared";
import { buildQueryString } from "@/lib/query";
import { useTeam } from "@/contexts/team-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { TableSkeleton } from "@/components/ui/skeletons";
import { BreakdownChart } from "@/components/metrics/breakdown-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CountryCell } from "@/components/country-flag";
import { languageName } from "@/lib/country-flag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_PROJECTS = "__all__";
const ALL_APPS = "__all_apps__";

export default function LocalesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id;

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null,
  );
  const projects = projectsData?.projects ?? [];

  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    teamId ? `/v1/apps?team_id=${teamId}` : null,
  );
  const allApps = appsData?.apps ?? [];

  const [projectId, setProjectIdState] = useState<string>(
    searchParams.get("project_id") ?? ALL_PROJECTS,
  );
  const [appId, setAppIdState] = useState<string>(searchParams.get("app_id") ?? ALL_APPS);

  const isAllProjects = projectId === ALL_PROJECTS;
  const isAllApps = appId === ALL_APPS;

  // Apps available for the chosen project (locale demand is client-app shaped;
  // backend apps don't carry a device locale, so hide them from the picker).
  const availableApps = useMemo(
    () =>
      allApps.filter(
        (a) => a.platform !== "backend" && (isAllProjects || a.project_id === projectId),
      ),
    [allApps, isAllProjects, projectId],
  );

  function updateUrl(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "" || v === ALL_PROJECTS || v === ALL_APPS) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.replace(`/dashboard/locales${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  function setProjectId(v: string) {
    setProjectIdState(v);
    setAppIdState(ALL_APPS);
    updateUrl({ project_id: v, app_id: null });
  }
  function setAppId(v: string) {
    setAppIdState(v);
    updateUrl({ app_id: v === ALL_APPS ? null : v });
  }

  // Reset a stale app filter when the project changes.
  useEffect(() => {
    if (!isAllApps && !availableApps.some((a) => a.id === appId)) {
      setAppId(ALL_APPS);
    }
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Project-scoped vs team-scoped endpoint (team_id ⊥ project_id).
  const key = useMemo(() => {
    if (!teamId) return null;
    if (isAllProjects) {
      const qs = buildQueryString({ team_id: teamId, app_id: isAllApps ? undefined : appId });
      return `/v1/users/locales?${qs}`;
    }
    const qs = buildQueryString({ app_id: isAllApps ? undefined : appId });
    return `/v1/projects/${projectId}/users/locales${qs ? `?${qs}` : ""}`;
  }, [teamId, isAllProjects, projectId, isAllApps, appId]);

  const { data, isLoading } = useSWR<UserLocalesResponse>(key);

  const demandTotal = data?.users_with_preferred_language ?? 0;
  const totalUsers = data?.total_users ?? 0;
  const coveragePct = totalUsers > 0 ? (demandTotal / totalUsers) * 100 : 0;
  const supported = data?.supported_languages ?? null;

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Globe className="h-6 w-6" /> Locales
            </h1>
            <p className="text-sm text-muted-foreground">
              Where the localization demand is. Language = what users want; country bridges the
              gap until everyone&apos;s on the latest SDK.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={appId} onValueChange={setAppId}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_APPS}>All apps</SelectItem>
                {availableApps.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </StaggerItem>

      {/* Summary strip */}
      <StaggerItem index={1}>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 py-3 text-sm">
            <div>
              <span className="font-semibold tabular-nums">{totalUsers.toLocaleString()}</span>{" "}
              <span className="text-muted-foreground">users</span>
            </div>
            <div>
              <span className="font-semibold tabular-nums">{demandTotal.toLocaleString()}</span>{" "}
              <span className="text-muted-foreground">
                report a preferred language ({coveragePct.toFixed(0)}%)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Shipped:</span>
              {supported && supported.length > 0 ? (
                supported.map((l) => (
                  <Badge key={l} variant="outline" tone="green" size="sm">
                    {l}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">
                  {isAllProjects ? "select a project to see gaps" : "not reported yet"}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      {isLoading ? (
        <StaggerItem index={2}>
          <TableSkeleton rows={6} />
        </StaggerItem>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* By language (demand) */}
          <StaggerItem index={2}>
            <Card>
              <CardContent className="space-y-4 py-4">
                <BreakdownChart
                  title="By language (what users want)"
                  data={(data?.by_locale ?? []).map((r) => ({
                    label: r.locale,
                    count: r.user_count,
                  }))}
                  total={demandTotal}
                />
                {data && data.by_locale.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Locale</TableHead>
                        <TableHead className="text-right">Users</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                        <TableHead className="text-right">Gap</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_locale.map((r) => {
                        const pct = demandTotal > 0 ? (r.user_count / demandTotal) * 100 : 0;
                        return (
                          <TableRow key={r.locale}>
                            <TableCell>
                              <span className="font-mono text-xs">{r.locale}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {languageName(r.locale)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.user_count.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {pct.toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-right">
                              {r.shipped === false ? (
                                <Badge variant="outline" tone="red" size="sm">
                                  Not shipped
                                </Badge>
                              ) : r.shipped === true ? (
                                <Badge variant="outline" tone="green" size="sm">
                                  Shipped
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No preferred-language data yet — users need the latest SDK. The country
                    breakdown is your signal in the meantime.
                  </p>
                )}
              </CardContent>
            </Card>
          </StaggerItem>

          {/* By country (immediate proxy) */}
          <StaggerItem index={3}>
            <Card>
              <CardContent className="space-y-4 py-4">
                <BreakdownChart
                  title="By country (works for everyone today)"
                  data={(data?.by_country ?? []).map((r) => ({
                    label: r.country_code,
                    count: r.user_count,
                  }))}
                  total={totalUsers}
                />
                {data && data.by_country.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Country</TableHead>
                        <TableHead className="text-right">Users</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_country.map((r) => {
                        const pct = totalUsers > 0 ? (r.user_count / totalUsers) * 100 : 0;
                        return (
                          <TableRow key={r.country_code}>
                            <TableCell>
                              <CountryCell code={r.country_code} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.user_count.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {pct.toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No country data yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </StaggerItem>
        </div>
      )}
    </AnimatedPage>
  );
}
