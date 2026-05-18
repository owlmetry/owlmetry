"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { buildQueryString } from "@/lib/query";
import type {
  IssueDetailResponse,
  IssueResponse,
  IssueStatus,
  IssuesQueryParams,
  IssuesResponse,
} from "@owlmetry/shared";

export function useIssues(filters: Partial<IssuesQueryParams> = {}) {
  const qs = buildQueryString(filters);
  const hasTeamOrProject = filters.team_id || filters.project_id;
  const key = hasTeamOrProject ? `/v1/issues${qs ? `?${qs}` : ""}` : null;

  const { data, isLoading, error, mutate } = useSWR<IssuesResponse>(key, {
    refreshInterval: 30_000,
  });

  return {
    issues: data?.issues ?? [],
    cursor: data?.cursor ?? null,
    hasMore: data?.has_more ?? false,
    isLoading,
    error,
    mutate,
  };
}

type UseIssuesByStatusArgs = {
  team_id: string | undefined;
  project_id?: string;
  data_mode?: string;
  status: IssueStatus;
  // When true, the hook auto-drains every page after the first SWR response.
  // When false, callers trigger drain manually via loadAll().
  autoLoadAll: boolean;
  // First-page size. Auto-load columns override this to the server cap (200)
  // to minimize round-trips.
  pageSize?: number;
};

/**
 * Per-status kanban column fetcher with optional full-set drain.
 *
 * SERVER_MAX_PAGE_SIZE mirrors the route's cap in apps/server/src/routes/issues.ts
 * (MAX_PAGE_SIZE = 200). Requests above this are clamped server-side.
 */
const SERVER_MAX_PAGE_SIZE = 200;

export function useIssuesByStatus(args: UseIssuesByStatusArgs) {
  const { team_id, project_id, data_mode, status, autoLoadAll, pageSize = 50 } = args;

  const filters: Record<string, string> = {};
  if (team_id) filters.team_id = team_id;
  if (project_id) filters.project_id = project_id;
  if (data_mode) filters.data_mode = data_mode;
  filters.status = status;
  filters.limit = String(autoLoadAll ? SERVER_MAX_PAGE_SIZE : pageSize);

  const qs = buildQueryString(filters);
  const key = team_id ? `/v1/issues?${qs}` : null;

  const { data, isLoading, mutate } = useSWR<IssuesResponse>(key, {
    refreshInterval: 30_000,
  });

  // Sticky snapshot of the full drained set. Cleared on every fresh SWR response
  // so newly-arrived issues aren't masked; re-populated by drain() on the next tick.
  const [drainedIssues, setDrainedIssues] = useState<IssueResponse[] | null>(null);
  const [isDraining, setIsDraining] = useState(false);
  // Sticks "user wants full view" across SWR refreshes — without it, every 30s
  // refresh would collapse a manually-expanded column back to the first page.
  const [userOptedIntoAll, setUserOptedIntoAll] = useState(false);

  const prevKeyRef = useRef(key);
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      setDrainedIssues(null);
      setUserOptedIntoAll(false);
    }
  }, [key]);

  const prevDataRef = useRef<IssuesResponse | undefined>(undefined);
  useEffect(() => {
    if (data && prevDataRef.current !== data) {
      prevDataRef.current = data;
      setDrainedIssues(null);
    }
  }, [data]);

  // Stable refs so drain() doesn't churn its identity each render.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const drain = useCallback(async () => {
    if (isDraining) return;
    const snapshot = data;
    if (!snapshot || !snapshot.has_more) return;
    setIsDraining(true);
    try {
      const acc = [...snapshot.issues];
      let nextCursor = snapshot.cursor;
      while (nextCursor) {
        const params = { ...filtersRef.current, cursor: nextCursor };
        const drainQs = buildQueryString(params);
        const res = await api.get<IssuesResponse>(`/v1/issues?${drainQs}`);
        acc.push(...res.issues);
        nextCursor = res.cursor;
      }
      setDrainedIssues(acc);
    } finally {
      setIsDraining(false);
    }
  }, [data, isDraining]);

  // Auto-drain when the column is configured to always show everything, OR when
  // the user has previously opted in this session.
  useEffect(() => {
    const wantsDrain = autoLoadAll || userOptedIntoAll;
    if (wantsDrain && data && data.has_more && !drainedIssues && !isDraining) {
      void drain();
    }
  }, [autoLoadAll, userOptedIntoAll, data, drainedIssues, isDraining, drain]);

  const loadAll = useCallback(() => {
    setUserOptedIntoAll(true);
    void drain();
  }, [drain]);

  const issues = drainedIssues ?? data?.issues ?? [];
  const hasMore = drainedIssues ? false : (data?.has_more ?? false);

  return {
    issues,
    isLoading,
    isLoadingMore: isDraining,
    hasMore,
    loadAll,
    mutate,
  };
}

export function useIssue(projectId: string | undefined, issueId: string | undefined) {
  const key = projectId && issueId ? `/v1/projects/${projectId}/issues/${issueId}` : null;

  const { data, isLoading, error, mutate } = useSWR<IssueDetailResponse>(key, {
    refreshInterval: 30_000,
  });

  return { issue: data ?? null, isLoading, error, mutate };
}

// Issue API actions
export const issueActions = {
  updateStatus: (projectId: string, issueId: string, status: string, resolvedAtVersion?: string) =>
    api.patch(`/v1/projects/${projectId}/issues/${issueId}`, {
      status,
      ...(resolvedAtVersion ? { resolved_at_version: resolvedAtVersion } : {}),
    }),

  merge: (projectId: string, targetId: string, sourceId: string) =>
    api.post(`/v1/projects/${projectId}/issues/${targetId}/merge`, {
      source_issue_id: sourceId,
    }),

  addComment: (projectId: string, issueId: string, body: string) =>
    api.post(`/v1/projects/${projectId}/issues/${issueId}/comments`, { body }),

  editComment: (projectId: string, issueId: string, commentId: string, body: string) =>
    api.patch(`/v1/projects/${projectId}/issues/${issueId}/comments/${commentId}`, { body }),

  deleteComment: (projectId: string, issueId: string, commentId: string) =>
    api.delete(`/v1/projects/${projectId}/issues/${issueId}/comments/${commentId}`),
};
