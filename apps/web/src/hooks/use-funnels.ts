"use client";

import useSWR from "swr";
import { buildQueryString } from "@/lib/query";
import type {
  FunnelDefinitionResponse,
  FunnelQueryResponse,
  FunnelQueryParams,
} from "@owlmetry/shared";

export function useFunnels(projectId: string | null) {
  const key = projectId ? `/v1/funnels?project_id=${projectId}` : null;
  const { data, isLoading, error, mutate } = useSWR<{ funnels: FunnelDefinitionResponse[] }>(key);

  return {
    funnels: data?.funnels ?? [],
    isLoading,
    error,
    mutate,
  };
}

export function useFunnelQuery(
  slug: string | undefined,
  projectId: string | undefined,
  params: Partial<Omit<FunnelQueryParams, "project_id">> = {},
) {
  const qs = slug && projectId
    ? buildQueryString({ project_id: projectId, ...params })
    : null;
  const key = qs ? `/v1/funnels/${slug}/query?${qs}` : null;

  const { data, isLoading, error } = useSWR<FunnelQueryResponse>(key, {
    refreshInterval: 30_000,
  });

  return {
    data: data ?? null,
    isLoading,
    error,
  };
}
