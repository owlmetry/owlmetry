"use client";

import useSWR from "swr";
import type { ListApiKeysResponse } from "@owlmetry/shared";

export function useApiKeys() {
  const { data, isLoading, error, mutate } = useSWR<ListApiKeysResponse>("/v1/auth/keys");

  return {
    apiKeys: data?.api_keys ?? [],
    isLoading,
    error,
    mutate,
  };
}
