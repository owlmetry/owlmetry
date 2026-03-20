"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { buildQueryString } from "@/lib/query";
import type { AuditLogsResponse, AuditLogsQueryParams, AuditLogResponse } from "@owlmetry/shared";

export function useAuditLogs(teamId: string | undefined, filters: AuditLogsQueryParams) {
  const [extraLogs, setExtraLogs] = useState<AuditLogResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const qs = buildQueryString(filters);
  const key = teamId ? `/v1/teams/${teamId}/audit-logs${qs ? `?${qs}` : ""}` : null;

  const { data, isLoading, mutate } = useSWR<AuditLogsResponse>(key, {
    refreshInterval: 30_000,
  });

  const prevKeyRef = useRef(key);
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      setExtraLogs([]);
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
      const res = await api.get<AuditLogsResponse>(`/v1/teams/${teamId}/audit-logs?${nextQs}`);
      setExtraLogs((prev) => [...prev, ...res.audit_logs]);
      setCursor(res.cursor);
      setHasMore(res.has_more);
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, isLoadingMore, filters, teamId]);

  const auditLogs = [...(data?.audit_logs ?? []), ...extraLogs];

  return { auditLogs, isLoading, isLoadingMore, hasMore, loadMore, mutate };
}
