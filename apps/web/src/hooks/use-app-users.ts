"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { AppUsersResponse, AppUsersQueryParams, AppUserResponse } from "@owlmetry/shared";

function buildQueryString(params: AppUsersQueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== null) {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

export function useAppUsers(appId: string, filters: AppUsersQueryParams) {
  const [extraUsers, setExtraUsers] = useState<AppUserResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const qs = buildQueryString(filters);
  const key = `/v1/apps/${appId}/users${qs ? `?${qs}` : ""}`;

  const { data, isLoading, mutate } = useSWR<AppUsersResponse>(key, {
    refreshInterval: 30_000,
  });

  // Track the previous key to reset pagination on filter change
  const prevKeyRef = useRef(key);
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      setExtraUsers([]);
      setCursor(null);
      setHasMore(false);
    }
  }, [key]);

  // Sync cursor/hasMore from first page
  useEffect(() => {
    if (data) {
      setCursor(data.cursor);
      setHasMore(data.has_more);
    }
  }, [data]);

  const loadMore = useCallback(async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const params = { ...filters, cursor };
      const nextQs = buildQueryString(params);
      const res = await api.get<AppUsersResponse>(`/v1/apps/${appId}/users?${nextQs}`);
      setExtraUsers((prev) => [...prev, ...res.users]);
      setCursor(res.cursor);
      setHasMore(res.has_more);
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, isLoadingMore, filters, appId]);

  const users = [...(data?.users ?? []), ...extraUsers];

  return { users, isLoading, isLoadingMore, hasMore, loadMore, mutate };
}
