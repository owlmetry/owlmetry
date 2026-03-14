"use client";

import useSWR from "swr";
import type { MeResponse } from "@owlmetry/shared";

export function useUser() {
  const { data, error, isLoading, mutate } = useSWR<MeResponse>("/v1/auth/me");

  return {
    user: data?.user,
    teams: data?.teams,
    isLoading,
    error,
    mutate,
  };
}
