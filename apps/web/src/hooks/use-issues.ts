"use client";

import useSWR from "swr";
import { api } from "@/lib/api";
import { buildQueryString } from "@/lib/query";
import type { IssuesResponse, IssueDetailResponse, IssuesQueryParams, IssueCommentResponse } from "@owlmetry/shared";

export function useIssues(projectId: string | undefined, filters: Partial<IssuesQueryParams> = {}) {
  const qs = buildQueryString(filters);
  const key = projectId ? `/v1/projects/${projectId}/issues${qs ? `?${qs}` : ""}` : null;

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

export function useIssue(projectId: string | undefined, issueId: string | undefined) {
  const key = projectId && issueId ? `/v1/projects/${projectId}/issues/${issueId}` : null;

  const { data, isLoading, error, mutate } = useSWR<IssueDetailResponse>(key, {
    refreshInterval: 30_000,
  });

  return { issue: data ?? null, isLoading, error, mutate };
}

export function useIssueComments(projectId: string | undefined, issueId: string | undefined) {
  const key = projectId && issueId ? `/v1/projects/${projectId}/issues/${issueId}/comments` : null;

  const { data, isLoading, error, mutate } = useSWR<{ comments: IssueCommentResponse[] }>(key);

  return { comments: data?.comments ?? [], isLoading, error, mutate };
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
