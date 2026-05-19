"use client";

import useSWR from "swr";
import { api } from "@/lib/api";
import { buildQueryString } from "@/lib/query";
import type {
  QuestionnaireListResponse,
  QuestionnaireDetailResponse,
  QuestionnaireQueryParams,
  QuestionnaireResponsesListResponse,
  QuestionnaireResponseDetailResponse,
  QuestionnaireResponseQueryParams,
  QuestionnaireAnalyticsResponse,
  QuestionnaireResponseStatus,
  QuestionnaireSchema,
  TeamQuestionnaireListResponse,
} from "@owlmetry/shared";

export function useQuestionnaires(
  projectId: string | undefined,
  filters: Partial<QuestionnaireQueryParams> = {},
) {
  const qs = buildQueryString(filters);
  const key = projectId ? `/v1/projects/${projectId}/questionnaires${qs ? `?${qs}` : ""}` : null;
  const { data, isLoading, error, mutate } = useSWR<QuestionnaireListResponse>(key, {
    refreshInterval: 30_000,
  });
  return {
    questionnaires: data?.questionnaires ?? [],
    cursor: data?.cursor ?? null,
    hasMore: data?.has_more ?? false,
    isLoading,
    error,
    mutate,
  };
}

export function useTeamQuestionnaires(
  teamId: string | undefined,
  filters: { is_active?: boolean } = {},
  dataMode?: string,
) {
  const params: Record<string, string> = {};
  if (teamId) params.team_id = teamId;
  if (filters.is_active !== undefined) params.is_active = String(filters.is_active);
  if (dataMode) params.data_mode = dataMode;
  const qs = buildQueryString(params);
  const key = teamId ? `/v1/questionnaires${qs ? `?${qs}` : ""}` : null;
  const { data, isLoading, error, mutate } = useSWR<TeamQuestionnaireListResponse>(key, {
    refreshInterval: 30_000,
  });
  return {
    questionnaires: data?.questionnaires ?? [],
    isLoading,
    error,
    mutate,
  };
}

export function useQuestionnaire(
  projectId: string | undefined,
  questionnaireId: string | undefined,
  dataMode?: string,
) {
  const params: Record<string, string> = {};
  if (dataMode) params.data_mode = dataMode;
  const qs = buildQueryString(params);
  const key = projectId && questionnaireId
    ? `/v1/projects/${projectId}/questionnaires/${questionnaireId}${qs ? `?${qs}` : ""}`
    : null;
  const { data, isLoading, error, mutate } = useSWR<QuestionnaireDetailResponse>(key, {
    refreshInterval: 30_000,
  });
  return { questionnaire: data ?? null, isLoading, error, mutate };
}

export function useQuestionnaireResponses(
  projectId: string | undefined,
  questionnaireId: string | undefined,
  filters: Partial<QuestionnaireResponseQueryParams> = {},
) {
  const qs = buildQueryString(filters);
  const key = projectId && questionnaireId
    ? `/v1/projects/${projectId}/questionnaires/${questionnaireId}/responses${qs ? `?${qs}` : ""}`
    : null;
  const { data, isLoading, error, mutate } = useSWR<QuestionnaireResponsesListResponse>(key, {
    refreshInterval: 30_000,
  });
  return {
    responses: data?.responses ?? [],
    cursor: data?.cursor ?? null,
    hasMore: data?.has_more ?? false,
    isLoading,
    error,
    mutate,
  };
}

export function useQuestionnaireResponseDetail(
  projectId: string | undefined,
  questionnaireId: string | undefined,
  responseId: string | undefined,
) {
  const key = projectId && questionnaireId && responseId
    ? `/v1/projects/${projectId}/questionnaires/${questionnaireId}/responses/${responseId}`
    : null;
  const { data, isLoading, error, mutate } = useSWR<QuestionnaireResponseDetailResponse>(key, {
    refreshInterval: 30_000,
  });
  return { response: data ?? null, isLoading, error, mutate };
}

export function useQuestionnaireAnalytics(
  projectId: string | undefined,
  questionnaireId: string | undefined,
  dataMode?: string,
) {
  const params: Record<string, string> = {};
  if (dataMode) params.data_mode = dataMode;
  const qs = buildQueryString(params);
  const key = projectId && questionnaireId
    ? `/v1/projects/${projectId}/questionnaires/${questionnaireId}/analytics${qs ? `?${qs}` : ""}`
    : null;
  const { data, isLoading, error, mutate } = useSWR<QuestionnaireAnalyticsResponse>(key, {
    refreshInterval: 30_000,
  });
  return { analytics: data ?? null, isLoading, error, mutate };
}

export const questionnaireActions = {
  create: (
    projectId: string,
    body: {
      slug: string;
      name: string;
      description?: string | null;
      schema: QuestionnaireSchema;
      app_id?: string | null;
      is_active?: boolean;
    },
  ) => api.post(`/v1/projects/${projectId}/questionnaires`, body),

  update: (
    projectId: string,
    questionnaireId: string,
    body: Partial<{
      name: string;
      description: string | null;
      schema: QuestionnaireSchema;
      app_id: string | null;
      is_active: boolean;
    }>,
  ) => api.patch(`/v1/projects/${projectId}/questionnaires/${questionnaireId}`, body),

  remove: (projectId: string, questionnaireId: string) =>
    api.delete(`/v1/projects/${projectId}/questionnaires/${questionnaireId}`),

  updateResponseStatus: (
    projectId: string,
    questionnaireId: string,
    responseId: string,
    status: QuestionnaireResponseStatus,
  ) => api.patch(
    `/v1/projects/${projectId}/questionnaires/${questionnaireId}/responses/${responseId}`,
    { status },
  ),

  addComment: (
    projectId: string,
    questionnaireId: string,
    responseId: string,
    body: string,
  ) => api.post(
    `/v1/projects/${projectId}/questionnaires/${questionnaireId}/responses/${responseId}/comments`,
    { body },
  ),
};
