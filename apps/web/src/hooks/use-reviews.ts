"use client";

import useSWR from "swr";
import { api } from "@/lib/api";
import { buildQueryString } from "@/lib/query";
import type {
  ReviewsListResponse,
  ReviewResponse,
  ReviewsQueryParams,
  ReviewsCountryFacets,
} from "@owlmetry/shared";

export function useReviews(
  filters: Partial<ReviewsQueryParams> & { team_id?: string; project_id?: string } = {},
) {
  const qs = buildQueryString(filters);
  const hasTeamOrProject = filters.team_id || filters.project_id;
  const key = hasTeamOrProject ? `/v1/reviews${qs ? `?${qs}` : ""}` : null;

  const { data, isLoading, error, mutate } = useSWR<ReviewsListResponse>(key, {
    refreshInterval: 60_000,
  });

  return {
    reviews: data?.reviews ?? [],
    cursor: data?.cursor ?? null,
    hasMore: data?.has_more ?? false,
    isLoading,
    error,
    mutate,
  };
}

export function useReviewDetail(projectId: string | undefined, reviewId: string | undefined) {
  const key = projectId && reviewId ? `/v1/projects/${projectId}/reviews/${reviewId}` : null;
  const { data, isLoading, error, mutate } = useSWR<ReviewResponse>(key);
  return { review: data ?? null, isLoading, error, mutate };
}

export function useReviewsByCountry(
  scope: { projectId?: string; teamId?: string },
  filters: { app_id?: string; store?: string } = {},
) {
  const { projectId, teamId } = scope;
  const qs = buildQueryString(filters);
  // Project-scoped takes precedence; team-level used for "All projects" views.
  let key: string | null = null;
  if (projectId) {
    key = `/v1/projects/${projectId}/reviews/by-country${qs ? `?${qs}` : ""}`;
  } else if (teamId) {
    const teamQs = buildQueryString({ ...filters, team_id: teamId });
    key = `/v1/reviews/by-country${teamQs ? `?${teamQs}` : ""}`;
  }
  const { data, isLoading, error } = useSWR<ReviewsCountryFacets>(key, {
    refreshInterval: 60_000,
  });
  return { countries: data?.countries ?? [], isLoading, error };
}

export const reviewActions = {
  remove: (projectId: string, reviewId: string) =>
    api.delete(`/v1/projects/${projectId}/reviews/${reviewId}`),
};
