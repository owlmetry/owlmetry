import { sql } from "drizzle-orm";
import { adAdGroupLifetime, adCampaignLifetime, apps } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { ATTRIBUTION_SOURCE_VALUES } from "@owlmetry/shared";
import type { AppleAdsConfig } from "./config.js";
import {
  postAppleAdsAdGroupReport,
  postAppleAdsCampaignReport,
  type AppleAdsAdGroupReportMetadata,
  type AppleAdsCampaignReportMetadata,
  type AppleAdsReportRow,
  type AppleAdsResult,
} from "./client.js";
import { AppleAdsLookupCache } from "./enrich.js";

/**
 * Sync Apple Search Ads spend / impressions / taps / installs into
 * `ad_campaign_lifetime` + `ad_adgroup_lifetime` for one project.
 *
 * The Reports API is **org-scoped** — every campaign across every app under
 * the same Apple Developer team comes back in one response — so we filter
 * rows by `metadata.app.adamId` against `apps.apple_app_store_id`, dropping
 * campaigns that belong to a different project's apps.
 *
 * Apple caps single report requests at ~90 days, so for lifetime totals we
 * issue 4 chunked requests in parallel and sum the per-window `total` blocks.
 * Non-USD orgs get `total_spend_usd_cents` left null and the raw value
 * preserved in `spend_local_micros`; the route layer surfaces a
 * `currency_warning` for the dashboard banner.
 */

const NETWORK = ATTRIBUTION_SOURCE_VALUES.appleSearchAds;
const CHUNK_DAYS = 90;
const CHUNK_COUNT = 4; // 360 days ≈ "last 12 months" in Apple's dashboard.
const REPORT_PAGE_LIMIT = 1000;

export interface MetricsSyncResult {
  /** Total campaigns surfaced in the org-wide report (across all apps). */
  campaigns_seen: number;
  /** Subset whose `adamId` matches an app in this project. */
  campaigns_matched: number;
  /** Campaigns successfully upserted. */
  campaigns_upserted: number;
  /** Ad groups successfully upserted. */
  ad_groups_upserted: number;
  /** Most recent non-USD currency code seen, surfaced as a UI warning. */
  currency_warning: string | null;
  /** First auth error encountered, if any — aborts the run. */
  auth_error?: string;
  /** Non-fatal status-code histogram across all per-chunk requests. */
  error_status_counts: Record<string, number>;
}

interface CampaignAccumulator {
  campaignId: number;
  campaignName: string;
  campaignStatus: string;
  appAdamId: number;
  appId: string;
  spendLocalMicros: number;
  spendCurrency: string;
  impressions: number;
  taps: number;
  totalInstalls: number;
}

interface AdGroupAccumulator {
  adGroupId: number;
  campaignId: number;
  appId: string;
  adGroupName: string;
  adGroupStatus: string;
  startDate: string | null;
  endDate: string | null;
  spendLocalMicros: number;
  spendCurrency: string;
  impressions: number;
  taps: number;
  totalInstalls: number;
}

export async function syncAppleAdsMetrics(
  db: Db,
  teamId: string,
  projectId: string,
  config: AppleAdsConfig,
  cache: AppleAdsLookupCache,
): Promise<MetricsSyncResult> {
  const result: MetricsSyncResult = {
    campaigns_seen: 0,
    campaigns_matched: 0,
    campaigns_upserted: 0,
    ad_groups_upserted: 0,
    currency_warning: null,
    error_status_counts: {},
  };

  // Map adamId → app_id for fast filter + denormalization. We only sync for
  // Apple-platform apps with an apple_app_store_id; everything else can't be
  // matched anyway.
  const appRows = await db
    .select({
      id: apps.id,
      apple_app_store_id: apps.apple_app_store_id,
    })
    .from(apps)
    .where(sql`${apps.project_id} = ${projectId} AND ${apps.deleted_at} IS NULL AND ${apps.apple_app_store_id} IS NOT NULL`);

  if (appRows.length === 0) {
    return result;
  }

  const appByAdamId = new Map<number, string>();
  for (const row of appRows) {
    if (row.apple_app_store_id != null) {
      appByAdamId.set(Number(row.apple_app_store_id), row.id);
    }
  }

  const chunks = buildChunks();
  const campaignAcc = new Map<number, CampaignAccumulator>();
  const adGroupTargets = new Set<number>();

  // The 4 chunks are independent reads against different time windows; fetch
  // them in parallel. Apple's per-org rate limit is loose (~10/sec) so 4
  // concurrent calls is well below the ceiling.
  const chunkResults = await Promise.all(
    chunks.map((chunk) => fetchAllCampaignPages(config, chunk)),
  );

  for (const reportResult of chunkResults) {
    if (reportResult.status === "auth_error") {
      result.auth_error = reportResult.message;
      return result;
    }
    if (reportResult.status === "error") {
      const key = String(reportResult.statusCode);
      result.error_status_counts[key] = (result.error_status_counts[key] ?? 0) + 1;
      continue;
    }
    if (reportResult.status === "not_found") {
      continue;
    }

    for (const row of reportResult.data) {
      result.campaigns_seen++;
      const meta = row.metadata;
      const adamId = meta.app?.adamId;
      const appId = adamId ? appByAdamId.get(adamId) : undefined;
      if (!appId) {
        // Campaign belongs to a different app's project — skip.
        continue;
      }

      const total = row.total;
      if (!total) continue;
      const spendCurrency = total.localSpend?.currency ?? "";
      const spendAmountStr = total.localSpend?.amount ?? "0";
      const spendDeltaMicros = parseDecimalMicros(spendAmountStr);

      if (spendCurrency && spendCurrency !== "USD") {
        result.currency_warning = spendCurrency;
      }

      const prior = campaignAcc.get(meta.campaignId);
      if (prior) {
        prior.spendLocalMicros += spendDeltaMicros;
        prior.impressions += total.impressions ?? 0;
        prior.taps += total.taps ?? 0;
        prior.totalInstalls += total.totalInstalls ?? 0;
        // Latest-chunk metadata wins for status/name (most recent state).
        prior.campaignStatus = meta.campaignStatus ?? prior.campaignStatus;
        prior.campaignName = meta.campaignName ?? prior.campaignName;
      } else {
        result.campaigns_matched++;
        campaignAcc.set(meta.campaignId, {
          campaignId: meta.campaignId,
          campaignName: meta.campaignName ?? "",
          campaignStatus: meta.campaignStatus ?? "",
          appAdamId: adamId!,
          appId,
          spendLocalMicros: spendDeltaMicros,
          spendCurrency: spendCurrency || "USD",
          impressions: total.impressions ?? 0,
          taps: total.taps ?? 0,
          totalInstalls: total.totalInstalls ?? 0,
        });
        adGroupTargets.add(meta.campaignId);
      }
    }
  }

  // Per-campaign GET enriches start/end dates — Reports API doesn't carry
  // these on campaign rows. Run in parallel; AppleAdsLookupCache memoizes
  // hits already populated by the names pass so most calls return instantly.
  const campaignDateMap = new Map<number, { startDate: string | null; endDate: string | null }>();
  const dateLookups = await Promise.all(
    [...campaignAcc.values()].map(async (accum) => ({
      campaignId: accum.campaignId,
      result: await cache.getCampaign(config, String(accum.campaignId)),
    })),
  );
  for (const { campaignId, result: cached } of dateLookups) {
    if (cached.status === "auth_error") {
      result.auth_error = cached.message;
      return result;
    }
    if (cached.status === "found") {
      campaignDateMap.set(campaignId, {
        startDate: toDateOnly(cached.data.startTime),
        endDate: toDateOnly(cached.data.endTime),
      });
    } else if (cached.status === "error") {
      const key = String(cached.statusCode);
      result.error_status_counts[key] = (result.error_status_counts[key] ?? 0) + 1;
    }
  }

  // Upsert campaigns first so ad-groups have a parent row to point to.
  for (const accum of campaignAcc.values()) {
    const dates = campaignDateMap.get(accum.campaignId);
    const usdCents = accum.spendCurrency === "USD" ? Math.round(accum.spendLocalMicros / 10_000) : null;
    await db
      .insert(adCampaignLifetime)
      .values({
        team_id: teamId,
        project_id: projectId,
        app_id: accum.appId,
        apple_app_store_id: accum.appAdamId,
        network: NETWORK,
        campaign_id: String(accum.campaignId),
        campaign_name: accum.campaignName || null,
        campaign_status: accum.campaignStatus || null,
        campaign_start_date: dates?.startDate ?? null,
        campaign_end_date: dates?.endDate ?? null,
        total_spend_usd_cents: usdCents,
        spend_currency: accum.spendCurrency,
        spend_local_micros: accum.spendLocalMicros,
        total_impressions: accum.impressions,
        total_taps: accum.taps,
        total_installs: accum.totalInstalls,
        last_synced_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [adCampaignLifetime.project_id, adCampaignLifetime.network, adCampaignLifetime.campaign_id],
        set: {
          app_id: accum.appId,
          apple_app_store_id: accum.appAdamId,
          campaign_name: accum.campaignName || null,
          campaign_status: accum.campaignStatus || null,
          campaign_start_date: dates?.startDate ?? null,
          campaign_end_date: dates?.endDate ?? null,
          total_spend_usd_cents: usdCents,
          spend_currency: accum.spendCurrency,
          spend_local_micros: accum.spendLocalMicros,
          total_impressions: accum.impressions,
          total_taps: accum.taps,
          total_installs: accum.totalInstalls,
          last_synced_at: new Date(),
        },
      });
    result.campaigns_upserted++;
  }

  // Ad-group reports are scoped to a single campaign each — fan out across
  // the matched campaigns. The 4 chunks per campaign run in parallel; the
  // outer loop stays sequential to keep peak QPS bounded for orgs with many
  // campaigns.
  for (const campaignId of adGroupTargets) {
    const accum = campaignAcc.get(campaignId);
    if (!accum) continue;
    const adGroupAcc = new Map<number, AdGroupAccumulator>();

    const adGroupChunkResults = await Promise.all(
      chunks.map((chunk) => fetchAllAdGroupPages(config, campaignId, chunk)),
    );
    for (const reportResult of adGroupChunkResults) {
      if (reportResult.status === "auth_error") {
        result.auth_error = reportResult.message;
        return result;
      }
      if (reportResult.status === "error") {
        const key = String(reportResult.statusCode);
        result.error_status_counts[key] = (result.error_status_counts[key] ?? 0) + 1;
        continue;
      }
      if (reportResult.status === "not_found") continue;

      for (const row of reportResult.data) {
        const meta = row.metadata;
        const total = row.total;
        if (!total) continue;
        const spendCurrency = total.localSpend?.currency ?? "";
        const spendDeltaMicros = parseDecimalMicros(total.localSpend?.amount ?? "0");

        const prior = adGroupAcc.get(meta.adGroupId);
        if (prior) {
          prior.spendLocalMicros += spendDeltaMicros;
          prior.impressions += total.impressions ?? 0;
          prior.taps += total.taps ?? 0;
          prior.totalInstalls += total.totalInstalls ?? 0;
          prior.adGroupStatus = meta.adGroupStatus ?? prior.adGroupStatus;
          prior.adGroupName = meta.adGroupName ?? prior.adGroupName;
          // Earliest start, latest end across chunks.
          if (meta.startTime) {
            const d = toDateOnly(meta.startTime);
            if (d && (!prior.startDate || d < prior.startDate)) prior.startDate = d;
          }
          if (meta.endTime) {
            const d = toDateOnly(meta.endTime);
            if (d && (!prior.endDate || d > prior.endDate)) prior.endDate = d;
          }
        } else {
          adGroupAcc.set(meta.adGroupId, {
            adGroupId: meta.adGroupId,
            campaignId: meta.campaignId,
            appId: accum.appId,
            adGroupName: meta.adGroupName ?? "",
            adGroupStatus: meta.adGroupStatus ?? "",
            startDate: toDateOnly(meta.startTime ?? null),
            endDate: toDateOnly(meta.endTime ?? null),
            spendLocalMicros: spendDeltaMicros,
            spendCurrency: spendCurrency || "USD",
            impressions: total.impressions ?? 0,
            taps: total.taps ?? 0,
            totalInstalls: total.totalInstalls ?? 0,
          });
        }
      }
    }

    for (const ag of adGroupAcc.values()) {
      const usdCents = ag.spendCurrency === "USD" ? Math.round(ag.spendLocalMicros / 10_000) : null;
      await db
        .insert(adAdGroupLifetime)
        .values({
          team_id: teamId,
          project_id: projectId,
          app_id: ag.appId,
          network: NETWORK,
          campaign_id: String(ag.campaignId),
          ad_group_id: String(ag.adGroupId),
          ad_group_name: ag.adGroupName || null,
          ad_group_status: ag.adGroupStatus || null,
          ad_group_start_date: ag.startDate,
          ad_group_end_date: ag.endDate,
          total_spend_usd_cents: usdCents,
          spend_currency: ag.spendCurrency,
          spend_local_micros: ag.spendLocalMicros,
          total_impressions: ag.impressions,
          total_taps: ag.taps,
          total_installs: ag.totalInstalls,
          last_synced_at: new Date(),
        })
        .onConflictDoUpdate({
          target: [adAdGroupLifetime.project_id, adAdGroupLifetime.network, adAdGroupLifetime.ad_group_id],
          set: {
            app_id: ag.appId,
            ad_group_name: ag.adGroupName || null,
            ad_group_status: ag.adGroupStatus || null,
            ad_group_start_date: ag.startDate,
            ad_group_end_date: ag.endDate,
            total_spend_usd_cents: usdCents,
            spend_currency: ag.spendCurrency,
            spend_local_micros: ag.spendLocalMicros,
            total_impressions: ag.impressions,
            total_taps: ag.taps,
            total_installs: ag.totalInstalls,
            last_synced_at: new Date(),
          },
        });
      result.ad_groups_upserted++;
    }
  }

  return result;
}

function buildChunks(): { startTime: string; endTime: string }[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const out: { startTime: string; endTime: string }[] = [];
  for (let i = 0; i < CHUNK_COUNT; i++) {
    const end = new Date(today);
    end.setUTCDate(today.getUTCDate() - i * CHUNK_DAYS - (i === 0 ? 0 : 1));
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - (CHUNK_DAYS - 1));
    out.push({ startTime: formatDate(start), endTime: formatDate(end) });
  }
  return out;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ASA returns `"2026-04-25T18:22:25.152"` (no zone). Trim to `YYYY-MM-DD`. */
function toDateOnly(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(input);
  return m ? m[1] : null;
}

/** Parse `"14.8051"` → integer micros (14_805_100). Avoids float drift. */
function parseDecimalMicros(amount: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000);
}

type FetchResult<T> = AppleAdsResult<T[]>;

async function fetchAllCampaignPages(
  config: AppleAdsConfig,
  chunk: { startTime: string; endTime: string },
): Promise<FetchResult<AppleAdsReportRow<AppleAdsCampaignReportMetadata>>> {
  const rows: AppleAdsReportRow<AppleAdsCampaignReportMetadata>[] = [];
  let offset = 0;
  while (true) {
    const result = await postAppleAdsCampaignReport(config, {
      startTime: chunk.startTime,
      endTime: chunk.endTime,
      granularity: "DAILY",
      limit: REPORT_PAGE_LIMIT,
      offset,
    });
    if (result.status !== "found") {
      return result;
    }
    const page = result.data.reportingDataResponse?.row ?? [];
    rows.push(...page);
    if (page.length < REPORT_PAGE_LIMIT) break;
    offset += REPORT_PAGE_LIMIT;
  }
  return { status: "found", data: rows };
}

async function fetchAllAdGroupPages(
  config: AppleAdsConfig,
  campaignId: number,
  chunk: { startTime: string; endTime: string },
): Promise<FetchResult<AppleAdsReportRow<AppleAdsAdGroupReportMetadata>>> {
  const rows: AppleAdsReportRow<AppleAdsAdGroupReportMetadata>[] = [];
  let offset = 0;
  while (true) {
    const result = await postAppleAdsAdGroupReport(config, campaignId, {
      startTime: chunk.startTime,
      endTime: chunk.endTime,
      granularity: "DAILY",
      limit: REPORT_PAGE_LIMIT,
      offset,
    });
    if (result.status !== "found") {
      return result;
    }
    const page = result.data.reportingDataResponse?.row ?? [];
    rows.push(...page);
    if (page.length < REPORT_PAGE_LIMIT) break;
    offset += REPORT_PAGE_LIMIT;
  }
  return { status: "found", data: rows };
}
