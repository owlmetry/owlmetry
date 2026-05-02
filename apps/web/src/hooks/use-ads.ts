"use client";

import useSWR from "swr";
import { api } from "@/lib/api";
import { buildQueryString } from "@/lib/query";
import type {
  AdsCampaignsResponse,
  TeamAdsCampaignsResponse,
  AdsAdGroupsResponse,
  AdsLeavesResponse,
} from "@owlmetry/shared/attribution";

interface AdsFilters {
  attribution_source?: string;
  app_id?: string;
  limit?: number;
}

export function useAdCampaigns(projectId: string | undefined, filters: AdsFilters = {}) {
  const qs = buildQueryString(filters);
  const key = projectId
    ? `/v1/projects/${projectId}/ads/campaigns${qs ? `?${qs}` : ""}`
    : null;
  const { data, isLoading, error, mutate } = useSWR<AdsCampaignsResponse>(key);
  return {
    campaigns: data?.campaigns ?? [],
    totalUserCount: data?.total_user_count ?? 0,
    totalPayingUserCount: data?.total_paying_user_count ?? 0,
    totalRevenueUsd: data?.total_revenue_usd ?? 0,
    totalSpendUsd: data?.total_spend_usd ?? null,
    revenueSyncedAt: data?.revenue_synced_at ?? null,
    adMetricsSyncedAt: data?.ad_metrics_synced_at ?? null,
    currencyWarning: data?.currency_warning ?? null,
    isLoading,
    error,
    mutate,
  };
}

interface TeamAdsFilters {
  attribution_source?: string;
  limit?: number;
}

export function useAdCampaignsAcrossTeam(
  teamId: string | undefined,
  filters: TeamAdsFilters = {},
) {
  const qs = buildQueryString({ team_id: teamId, ...filters });
  const key = teamId ? `/v1/ads/campaigns${qs ? `?${qs}` : ""}` : null;
  const { data, isLoading, error, mutate } = useSWR<TeamAdsCampaignsResponse>(key);
  return {
    campaigns: data?.campaigns ?? [],
    totalUserCount: data?.total_user_count ?? 0,
    totalPayingUserCount: data?.total_paying_user_count ?? 0,
    totalRevenueUsd: data?.total_revenue_usd ?? 0,
    totalSpendUsd: data?.total_spend_usd ?? null,
    revenueSyncedAt: data?.revenue_synced_at ?? null,
    adMetricsSyncedAt: data?.ad_metrics_synced_at ?? null,
    currencyWarning: data?.currency_warning ?? null,
    isLoading,
    error,
    mutate,
  };
}

export function useAdGroups(
  projectId: string | undefined,
  campaignId: string | undefined,
  filters: AdsFilters = {},
) {
  const qs = buildQueryString(filters);
  const key = projectId && campaignId
    ? `/v1/projects/${projectId}/ads/campaigns/${encodeURIComponent(campaignId)}/ad-groups${qs ? `?${qs}` : ""}`
    : null;
  const { data, isLoading, error, mutate } = useSWR<AdsAdGroupsResponse>(key);
  return {
    adGroups: data?.ad_groups ?? [],
    campaignName: data?.campaign_name ?? null,
    totalSpendUsd: data?.total_spend_usd ?? null,
    adMetricsSyncedAt: data?.ad_metrics_synced_at ?? null,
    currencyWarning: data?.currency_warning ?? null,
    isLoading,
    error,
    mutate,
  };
}

export function useAdLeaves(
  projectId: string | undefined,
  campaignId: string | undefined,
  adGroupId: string | undefined,
  filters: AdsFilters = {},
) {
  const qs = buildQueryString(filters);
  const key = projectId && campaignId && adGroupId
    ? `/v1/projects/${projectId}/ads/campaigns/${encodeURIComponent(campaignId)}/ad-groups/${encodeURIComponent(adGroupId)}/leaves${qs ? `?${qs}` : ""}`
    : null;
  const { data, isLoading, error, mutate } = useSWR<AdsLeavesResponse>(key);
  return {
    keywords: data?.keywords ?? [],
    ads: data?.ads ?? [],
    campaignName: data?.campaign_name ?? null,
    adGroupName: data?.ad_group_name ?? null,
    isLoading,
    error,
    mutate,
  };
}

export const adsActions = {
  sync: (projectId: string) =>
    api.post<{ syncing: true; revenuecat_job_run_id: string; apple_ads_job_run_id: string }>(
      `/v1/projects/${projectId}/ads/sync`,
      {},
    ),
};
