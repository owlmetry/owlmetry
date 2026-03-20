"use client";

import useSWR from "swr";
import { buildQueryString } from "@/lib/query";
import type {
  MetricDefinitionResponse,
  MetricQueryResponse,
  MetricEventsResponse,
  MetricQueryParams,
  MetricEventsQueryParams,
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
