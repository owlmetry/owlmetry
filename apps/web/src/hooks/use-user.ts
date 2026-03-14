"use client";

import useSWR from "swr";

interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface TeamMembership {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

interface MeResponse {
  user: User;
  teams: TeamMembership[];
}

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
