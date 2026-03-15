"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { EventsResponse, EventsQueryParams, StoredEventResponse } from "@owlmetry/shared";

function buildQueryString(params: EventsQueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== null) {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

export function useEvents(filters: EventsQueryParams) {
  const [extraEvents, setExtraEvents] = useState<StoredEventResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const qs = buildQueryString(filters);
  const key = `/v1/events${qs ? `?${qs}` : ""}`;

  const { data, isLoading, mutate } = useSWR<EventsResponse>(key, {
    refreshInterval: 10_000,
  });

  // Track the previous key to reset pagination on filter change
  const prevKeyRef = useRef(key);
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      setExtraEvents([]);
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
      const res = await api.get<EventsResponse>(`/v1/events?${nextQs}`);
      setExtraEvents((prev) => [...prev, ...res.events]);
      setCursor(res.cursor);
      setHasMore(res.has_more);
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, isLoadingMore, filters]);

  const events = [...(data?.events ?? []), ...extraEvents];

  return { events, isLoading, isLoadingMore, hasMore, loadMore, mutate };
}
