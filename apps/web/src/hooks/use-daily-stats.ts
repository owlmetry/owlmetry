"use client";

import useSWR from "swr";
import type {
  DataMode,
  StatsBucketedResponse,
  StatsGrain,
  StatsKind,
} from "@owlmetry/shared";

interface UseDailyStatsOpts {
  kind: StatsKind;
  grain?: StatsGrain;
  teamId?: string;
  projectId?: string;
  appId?: string;
  /** For daily grain. Excludes the current UTC day by default. */
  days?: number;
  /** For hourly grain. Excludes the current UTC hour by default. */
  hours?: number;
  dataMode: DataMode;
  slug?: string;
  /** Skip the request entirely (e.g. team/project not yet known). */
  skip?: boolean;
}

/**
 * One SWR hook for every stats kind / grain combo. Defaults to daily grain
 * with the dashboard's 30-day window (excluding today) — callers override
 * `days` to follow the user's preference.
 *
 * Returns:
 *   - `values`: numbers in chronological order, zero-padded to the requested
 *     window length even when the bucket has no underlying data. Sparkline
 *     consumers can read this directly without worrying about gaps.
 *   - `data`: the raw response if more detail is needed (date strings, etc.).
 *
 * The refresh interval is 5 minutes — sparklines describe a multi-day trend,
 * so the 30-second cadence used by the "·24h" magnitude cards is overkill.
 */
export function useDailyStats({
  kind,
  grain = "daily",
  teamId,
  projectId,
  appId,
  days,
  hours,
  dataMode,
  slug,
  skip,
}: UseDailyStatsOpts) {
  const params = new URLSearchParams();
  if (teamId && !projectId) params.set("team_id", teamId);
  if (appId) params.set("app_id", appId);
  if (days !== undefined && grain === "daily") params.set("days", String(days));
  if (hours !== undefined && grain === "hourly") params.set("hours", String(hours));
  params.set("data_mode", dataMode);
  if (slug) params.set("slug", slug);

  const basePath = projectId
    ? `/v1/projects/${projectId}/stats/${kind}/${grain}`
    : `/v1/stats/${kind}/${grain}`;
  const path = `${basePath}?${params.toString()}`;

  const shouldFetch = !skip && (Boolean(teamId) || Boolean(projectId));

  const { data, error, isLoading } = useSWR<StatsBucketedResponse>(
    shouldFetch ? path : null,
    { refreshInterval: 5 * 60_000 },
  );

  const values = data?.data.map((p) => p.value) ?? [];
  return { values, data, error, isLoading };
}
