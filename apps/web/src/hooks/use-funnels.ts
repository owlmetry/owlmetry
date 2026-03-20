"use client";

import useSWR from "swr";
import { buildQueryString } from "@/lib/query";
import type {
  FunnelDefinitionResponse,
  FunnelQueryResponse,
  FunnelQueryParams,
} from "@owlmetry/shared";

export function useFunnels(projectId: string | null) {
  const key = projectId ? `/v1/projects/${projectId}/funnels` : null;
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
  params: Partial<FunnelQueryParams> = {},
) {
  const qs = slug && projectId
    ? buildQueryString(params)
    : null;
  const key = qs !== null && slug && projectId ? `/v1/projects/${projectId}/funnels/${slug}/query${qs ? `?${qs}` : ""}` : null;

  const { data, isLoading, error } = useSWR<FunnelQueryResponse>(key, {
    refreshInterval: 30_000,
  });

  return {
    data: data ?? null,
    isLoading,
    error,
  };
}
