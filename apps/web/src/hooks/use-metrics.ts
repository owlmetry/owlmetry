"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { buildQueryString } from "@/lib/query";
import type {
  MetricDefinitionResponse,
  MetricQueryResponse,
  MetricEventsResponse,
  MetricQueryParams,
  MetricEventsQueryParams,
  MetricStatsParams,
  MetricStatsResponse,
  MetricStatsEntry,
  TeamMetricListResponse,
  TeamMetricStatsResponse,
  TeamMetricStatsEntry,
} from "@owlmetry/shared";

export function useMetricDefinitions(projectId: string | undefined) {
  const key = projectId ? `/v1/projects/${projectId}/metrics` : null;
  const { data, isLoading, error, mutate } = useSWR<{ metrics: MetricDefinitionResponse[] }>(key);

  return {
    metrics: data?.metrics ?? [],
    isLoading,
    error,
    mutate,
  };
}

export function useTeamMetricDefinitions(teamId: string | undefined) {
  const key = teamId ? `/v1/metrics?team_id=${teamId}` : null;
  const { data, isLoading, error, mutate } = useSWR<TeamMetricListResponse>(key);

  return {
    metrics: data?.metrics ?? [],
    isLoading,
    error,
    mutate,
  };
}

export function useMetricQuery(slug: string | undefined, projectId: string | undefined, params: Partial<MetricQueryParams> = {}) {
  const qs = slug && projectId
    ? buildQueryString(params)
    : null;
  const key = qs !== null && slug && projectId ? `/v1/projects/${projectId}/metrics/${slug}/query${qs ? `?${qs}` : ""}` : null;

  const { data, isLoading, error } = useSWR<MetricQueryResponse>(key, {
    refreshInterval: 30_000,
  });

  return {
    data: data ?? null,
    isLoading,
    error,
  };
}

export function useMetricStats(
  projectId: string | undefined,
  params: Partial<MetricStatsParams> = {},
) {
  const qs = projectId ? buildQueryString(params) : null;
  const key =
    qs !== null && projectId
      ? `/v1/projects/${projectId}/metric-stats${qs ? `?${qs}` : ""}`
      : null;

  const { data, isLoading, error } = useSWR<MetricStatsResponse>(key, {
    refreshInterval: 30_000,
  });

  const statsBySlug = useMemo(() => {
    const map = new Map<string, MetricStatsEntry>();
    for (const entry of data?.stats ?? []) {
      map.set(entry.slug, entry);
    }
    return map;
  }, [data]);

  return {
    stats: data?.stats ?? [],
    statsBySlug,
    isLoading,
    error,
  };
}

export function useTeamMetricStats(
  teamId: string | undefined,
  params: Partial<MetricStatsParams> = {},
) {
  const teamParams: Record<string, string> = teamId ? { team_id: teamId } : {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) teamParams[k] = String(v);
  }
  const qs = teamId ? buildQueryString(teamParams) : null;
  const key = teamId && qs !== null ? `/v1/metric-stats${qs ? `?${qs}` : ""}` : null;

  const { data, isLoading, error } = useSWR<TeamMetricStatsResponse>(key, {
    refreshInterval: 30_000,
  });

  // Slugs are only unique within a project, so the key needs project_id too —
  // otherwise two projects' metrics with the same slug would collide.
  const statsByProjectSlug = useMemo(() => {
    const map = new Map<string, TeamMetricStatsEntry>();
    for (const entry of data?.stats ?? []) {
      map.set(`${entry.project_id}:${entry.slug}`, entry);
    }
    return map;
  }, [data]);

  return {
    stats: data?.stats ?? [],
    statsByProjectSlug,
    isLoading,
    error,
  };
}

export function useMetricEvents(slug: string | undefined, projectId: string | undefined, params: Partial<MetricEventsQueryParams> = {}) {
  const qs = slug && projectId
    ? buildQueryString(params)
    : null;
  const key = qs !== null && slug && projectId ? `/v1/projects/${projectId}/metrics/${slug}/events${qs ? `?${qs}` : ""}` : null;

  const { data, isLoading, error } = useSWR<MetricEventsResponse>(key, {
    refreshInterval: 30_000,
  });

  return {
    events: data?.events ?? [],
    hasMore: data?.has_more ?? false,
    cursor: data?.cursor ?? null,
    isLoading,
    error,
  };
}
