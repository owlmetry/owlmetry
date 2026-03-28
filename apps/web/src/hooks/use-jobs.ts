"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { buildQueryString } from "@/lib/query";
import type { JobRunsResponse, JobRunsQueryParams, JobRunResponse } from "@owlmetry/shared";

export function useJobRuns(teamId: string | undefined, filters: Partial<JobRunsQueryParams>) {
  const [extraRuns, setExtraRuns] = useState<JobRunResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const qs = buildQueryString(filters);
  const key = teamId ? `/v1/teams/${teamId}/jobs${qs ? `?${qs}` : ""}` : null;

  const { data, isLoading, mutate } = useSWR<JobRunsResponse>(key, {
    refreshInterval: 5_000,
  });

  const prevKeyRef = useRef(key);
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      setExtraRuns([]);
      setCursor(null);
      setHasMore(false);
    }
  }, [key]);

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
      const res = await api.get<JobRunsResponse>(`/v1/teams/${teamId}/jobs?${nextQs}`);
      setExtraRuns((prev) => [...prev, ...res.job_runs]);
      setCursor(res.cursor);
      setHasMore(res.has_more);
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, isLoadingMore, filters, teamId]);

  const jobRuns = [...(data?.job_runs ?? []), ...extraRuns];

  return { jobRuns, isLoading, isLoadingMore, hasMore, loadMore, mutate };
}
