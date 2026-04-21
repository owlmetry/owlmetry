"use client";

import useSWR from "swr";
import { api } from "@/lib/api";
import { buildQueryString } from "@/lib/query";
import type {
  FeedbackListResponse,
  FeedbackDetailResponse,
  FeedbackQueryParams,
  FeedbackStatus,
} from "@owlmetry/shared";

export function useFeedback(filters: Partial<FeedbackQueryParams> = {}) {
  const qs = buildQueryString(filters);
  const hasTeamOrProject = filters.team_id || filters.project_id;
  const key = hasTeamOrProject ? `/v1/feedback${qs ? `?${qs}` : ""}` : null;

  const { data, isLoading, error, mutate } = useSWR<FeedbackListResponse>(key, {
    refreshInterval: 30_000,
  });

  return {
    feedback: data?.feedback ?? [],
    cursor: data?.cursor ?? null,
    hasMore: data?.has_more ?? false,
    isLoading,
    error,
    mutate,
  };
}

export function useFeedbackDetail(
  projectId: string | undefined,
  feedbackId: string | undefined,
) {
  const key = projectId && feedbackId ? `/v1/projects/${projectId}/feedback/${feedbackId}` : null;

  const { data, isLoading, error, mutate } = useSWR<FeedbackDetailResponse>(key, {
    refreshInterval: 30_000,
  });

  return { feedback: data ?? null, isLoading, error, mutate };
}

export const feedbackActions = {
  updateStatus: (projectId: string, feedbackId: string, status: FeedbackStatus) =>
    api.patch(`/v1/projects/${projectId}/feedback/${feedbackId}`, { status }),

  remove: (projectId: string, feedbackId: string) =>
    api.delete(`/v1/projects/${projectId}/feedback/${feedbackId}`),

  addComment: (projectId: string, feedbackId: string, body: string) =>
    api.post(`/v1/projects/${projectId}/feedback/${feedbackId}/comments`, { body }),

  editComment: (projectId: string, feedbackId: string, commentId: string, body: string) =>
    api.patch(`/v1/projects/${projectId}/feedback/${feedbackId}/comments/${commentId}`, { body }),

  deleteComment: (projectId: string, feedbackId: string, commentId: string) =>
    api.delete(`/v1/projects/${projectId}/feedback/${feedbackId}/comments/${commentId}`),
};
