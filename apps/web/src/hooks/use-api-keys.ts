"use client";

import useSWR from "swr";
import type { ListApiKeysResponse } from "@owlmetry/shared";

export function useApiKeys(teamId: string | null) {
  const key = teamId ? `/v1/auth/keys?team_id=${teamId}` : null;
  const { data, isLoading, error, mutate } = useSWR<ListApiKeysResponse>(key);

  return {
    apiKeys: data?.api_keys ?? [],
    isLoading,
    error,
    mutate,
  };
}
