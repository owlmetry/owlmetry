import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { appUsers, projects } from "@owlmetry/db";
import {
  ATTRIBUTION_NETWORK_DIMENSIONS,
  ATTRIBUTION_SOURCE_PROPERTY,
  ATTRIBUTION_SOURCE_VALUES,
  ADS_ATTRIBUTION_SOURCES,
  type AdsRow,
  type TeamAdsRow,
  type AdsCampaignsResponse,
  type TeamAdsCampaignsResponse,
  type AdsAdGroupsResponse,
  type AdsLeavesResponse,
} from "@owlmetry/shared";
import { requirePermission, assertTeamRole, getAuthTeamIds } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { formatManualTriggeredBy } from "../utils/integrations.js";

const DEFAULT_ATTRIBUTION_SOURCE = ATTRIBUTION_SOURCE_VALUES.appleSearchAds;

function parseAttributionSource(raw: string | undefined): string {
  if (!raw) return DEFAULT_ATTRIBUTION_SOURCE;
  return ADS_ATTRIBUTION_SOURCES.includes(raw) ? raw : DEFAULT_ATTRIBUTION_SOURCE;
}

type AdsAggregateRow = {
  id: string;
  name: string | null;
  user_count: number;
  paying_user_count: number;
  total_revenue_usd: number;
  /** Optional spend join — null when no `ad_*_lifetime` row matched. */
  total_spend_usd_cents?: number | null;
  spend_currency?: string | null;
  start_date?: string | null;
  status?: string | null;
} & Record<string, unknown>;

function toAdsRow(row: AdsAggregateRow): AdsRow {
  const userCount = Number(row.user_count) || 0;
  const totalRevenue = Number(row.total_revenue_usd) || 0;
  // total_spend_usd is null when (a) no spend row joined OR (b) the spend row
  // is in a non-USD currency (we leave `total_spend_usd_cents` null in that
  // case rather than fake-converting). ROAS follows: null when spend is null
  // or zero — `Infinity` is worse than "no signal" for ROAS UX.
  const cents = row.total_spend_usd_cents;
  const totalSpend = cents == null ? null : Number(cents) / 100;
  const roas = totalSpend == null || totalSpend === 0 ? null : totalRevenue / totalSpend;
  return {
    id: row.id,
    name: row.name,
    user_count: userCount,
    paying_user_count: Number(row.paying_user_count) || 0,
    total_revenue_usd: totalRevenue,
    arpu: userCount > 0 ? totalRevenue / userCount : 0,
    total_spend_usd: totalSpend,
    roas,
    start_date: row.start_date ?? null,
    status: row.status ?? null,
  };
}

function sumSpend(rows: AdsRow[]): number | null {
  let total = 0;
  let any = false;
  for (const row of rows) {
    if (row.total_spend_usd != null) {
      total += row.total_spend_usd;
      any = true;
    }
  }
  return any ? total : null;
}

/**
 * Build the SQL filter that scopes app_users to a single app via the
 * app_user_apps junction. Returns `sql\`\`` (no extra clause) when no app is
 * specified — keeps the project-wide path one-liner-clean.
 */
function appFilter(appId: string | undefined) {
  if (!appId) return sql``;
  return sql`AND ${appUsers.id} IN (SELECT app_user_id FROM app_user_apps WHERE app_id = ${appId})`;
}

export async function adsRoutes(app: FastifyInstance) {
  app.get<{
    Params: { projectId: string };
    Querystring: { attribution_source?: string; app_id?: string; limit?: string };
  }>(
    "/ads/campaigns",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const source = parseAttributionSource(request.query.attribution_source);
      const dims = ATTRIBUTION_NETWORK_DIMENSIONS[source];
      if (!dims) return reply.code(400).send({ error: "Unsupported attribution_source" });

      const appId = request.query.app_id;
      const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);

      // We group on COALESCE(name, id) — names are present on both
      // SDK-AdServices attribution (id+name) and RC-backfilled attribution
      // (name only, since RC stores `$campaign`/`$adGroup`/`$keyword` as
      // strings, never numeric IDs). Grouping on id alone would split a
      // single campaign into two buckets and hide the highest-revenue users
      // (the long-tail RC-backfilled ones) entirely. Drill-down accepts
      // either side of the COALESCE so URLs work regardless of which path
      // attributed each user.
      // Position-based `GROUP BY 1` avoids drizzle's parameter-placeholder
      // duplication tripping Postgres's textual-equality check on GROUP BY
      // expressions.
      // The `campaign_spend` CTE pulls each project's lifetime rollup and
      // joins on either `(campaign_id::text = aggregated.id)` (SDK path) OR
      // `(campaign_name = aggregated.id)` (RC backfill name-only path) —
      // matches the same dual-key story used everywhere else in this file.
      const rows = await app.db.execute<
        AdsAggregateRow & {
          revenue_synced_at: Date | null;
          ad_metrics_synced_at: Date | null;
          currency_warning: string | null;
        }
      >(sql`
        WITH project_sync AS (
          SELECT MAX(revenue_synced_at) AS synced_at
          FROM ${appUsers}
          WHERE project_id = ${projectId}
        ),
        campaign_revenue AS (
          SELECT
            COALESCE(properties->>${dims.campaignNameKey}, properties->>${dims.campaignIdKey}) AS id,
            MAX(properties->>${dims.campaignNameKey}) AS name,
            COUNT(*)::int AS user_count,
            COUNT(*) FILTER (WHERE COALESCE(total_revenue_usd_cents, 0) > 0)::int AS paying_user_count,
            (COALESCE(SUM(total_revenue_usd_cents), 0) / 100.0)::float AS total_revenue_usd
          FROM ${appUsers}
          WHERE project_id = ${projectId}
            AND properties->>${ATTRIBUTION_SOURCE_PROPERTY} = ${source}
            AND (properties ? ${dims.campaignNameKey} OR properties ? ${dims.campaignIdKey})
            ${appFilter(appId)}
          GROUP BY 1
        ),
        campaign_spend AS (
          SELECT
            campaign_id::text AS id_match,
            campaign_name AS name_match,
            total_spend_usd_cents,
            spend_currency,
            campaign_start_date,
            campaign_status,
            last_synced_at
          FROM ad_campaign_lifetime
          WHERE project_id = ${projectId} AND network = ${source}
        ),
        spend_meta AS (
          SELECT
            MAX(last_synced_at) AS ad_metrics_synced_at,
            MAX(spend_currency) FILTER (WHERE spend_currency IS NOT NULL AND spend_currency <> 'USD') AS currency_warning
          FROM campaign_spend
        )
        SELECT
          cr.id,
          cr.name,
          cr.user_count,
          cr.paying_user_count,
          cr.total_revenue_usd,
          cs.total_spend_usd_cents,
          cs.spend_currency,
          cs.campaign_start_date::text AS start_date,
          cs.campaign_status AS status,
          (SELECT synced_at FROM project_sync) AS revenue_synced_at,
          (SELECT ad_metrics_synced_at FROM spend_meta) AS ad_metrics_synced_at,
          (SELECT currency_warning FROM spend_meta) AS currency_warning
        FROM campaign_revenue cr
        LEFT JOIN campaign_spend cs
          ON cs.id_match = cr.id OR cs.name_match = cr.id
        ORDER BY cr.total_revenue_usd DESC, cr.user_count DESC, cr.id ASC
        LIMIT ${limit}
      `);

      const campaigns = rows.map(toAdsRow);
      const totalUserCount = campaigns.reduce((acc, r) => acc + r.user_count, 0);
      const totalPayingUserCount = campaigns.reduce((acc, r) => acc + r.paying_user_count, 0);
      const totalRevenueUsd = campaigns.reduce((acc, r) => acc + r.total_revenue_usd, 0);
      // Empty result set means no rows came back, but the timestamp lives on
      // every row when present — fall back to a 1-row probe.
      let revenueSyncedAt: string | null = rows[0]?.revenue_synced_at
        ? new Date(rows[0].revenue_synced_at).toISOString()
        : null;
      let adMetricsSyncedAt: string | null = rows[0]?.ad_metrics_synced_at
        ? new Date(rows[0].ad_metrics_synced_at).toISOString()
        : null;
      let currencyWarning: string | null = rows[0]?.currency_warning ?? null;
      if (rows.length === 0) {
        const [meta] = await app.db.execute<{
          revenue_synced_at: Date | null;
          ad_metrics_synced_at: Date | null;
          currency_warning: string | null;
        }>(sql`
          SELECT
            (SELECT MAX(revenue_synced_at) FROM ${appUsers} WHERE project_id = ${projectId}) AS revenue_synced_at,
            (SELECT MAX(last_synced_at) FROM ad_campaign_lifetime WHERE project_id = ${projectId} AND network = ${source}) AS ad_metrics_synced_at,
            (SELECT MAX(spend_currency) FROM ad_campaign_lifetime WHERE project_id = ${projectId} AND network = ${source} AND spend_currency IS NOT NULL AND spend_currency <> 'USD') AS currency_warning
        `);
        revenueSyncedAt = meta?.revenue_synced_at ? new Date(meta.revenue_synced_at).toISOString() : null;
        adMetricsSyncedAt = meta?.ad_metrics_synced_at ? new Date(meta.ad_metrics_synced_at).toISOString() : null;
        currencyWarning = meta?.currency_warning ?? null;
      }

      const response: AdsCampaignsResponse = {
        attribution_source: source,
        campaigns,
        total_user_count: totalUserCount,
        total_paying_user_count: totalPayingUserCount,
        total_revenue_usd: totalRevenueUsd,
        total_spend_usd: sumSpend(campaigns),
        revenue_synced_at: revenueSyncedAt,
        ad_metrics_synced_at: adMetricsSyncedAt,
        currency_warning: currencyWarning,
      };
      return response;
    },
  );

  app.get<{
    Params: { projectId: string; campaignId: string };
    Querystring: { attribution_source?: string; app_id?: string; limit?: string };
  }>(
    "/ads/campaigns/:campaignId/ad-groups",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const { projectId, campaignId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const source = parseAttributionSource(request.query.attribution_source);
      const dims = ATTRIBUTION_NETWORK_DIMENSIONS[source];
      if (!dims) return reply.code(400).send({ error: "Unsupported attribution_source" });

      const appId = request.query.app_id;
      const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);

      // Drill-down accepts either side of the campaign-row COALESCE — the URL
      // segment is whichever was non-null at aggregation time (name when
      // present, id otherwise). Same dual-key story for ad groups: RC-only
      // attributions carry the name, SDK-attributions carry both. Spend joins
      // mirror the campaigns route — match adGroup id::text or name.
      const rows = await app.db.execute<
        AdsAggregateRow & {
          campaign_name: string | null;
          ad_metrics_synced_at: Date | null;
          currency_warning: string | null;
        }
      >(sql`
        WITH adgroup_revenue AS (
          SELECT
            COALESCE(properties->>${dims.adGroupNameKey}, properties->>${dims.adGroupIdKey}) AS id,
            MAX(properties->>${dims.adGroupNameKey}) AS name,
            MAX(properties->>${dims.campaignNameKey}) AS campaign_name,
            COUNT(*)::int AS user_count,
            COUNT(*) FILTER (WHERE COALESCE(total_revenue_usd_cents, 0) > 0)::int AS paying_user_count,
            (COALESCE(SUM(total_revenue_usd_cents), 0) / 100.0)::float AS total_revenue_usd
          FROM ${appUsers}
          WHERE project_id = ${projectId}
            AND properties->>${ATTRIBUTION_SOURCE_PROPERTY} = ${source}
            AND (properties->>${dims.campaignIdKey} = ${campaignId} OR properties->>${dims.campaignNameKey} = ${campaignId})
            AND (properties ? ${dims.adGroupNameKey} OR properties ? ${dims.adGroupIdKey})
            ${appFilter(appId)}
          GROUP BY 1
        ),
        adgroup_spend AS (
          SELECT
            ad_group_id::text AS id_match,
            ad_group_name AS name_match,
            total_spend_usd_cents,
            spend_currency,
            ad_group_start_date,
            ad_group_status,
            last_synced_at
          FROM ad_adgroup_lifetime
          WHERE project_id = ${projectId} AND network = ${source}
            AND (campaign_id::text = ${campaignId} OR campaign_id IN (
              SELECT campaign_id FROM ad_campaign_lifetime
              WHERE project_id = ${projectId} AND network = ${source}
                AND (campaign_id::text = ${campaignId} OR campaign_name = ${campaignId})
            ))
        ),
        spend_meta AS (
          SELECT
            MAX(last_synced_at) AS ad_metrics_synced_at,
            MAX(spend_currency) FILTER (WHERE spend_currency IS NOT NULL AND spend_currency <> 'USD') AS currency_warning
          FROM adgroup_spend
        )
        SELECT
          ar.id,
          ar.name,
          ar.campaign_name,
          ar.user_count,
          ar.paying_user_count,
          ar.total_revenue_usd,
          asd.total_spend_usd_cents,
          asd.spend_currency,
          asd.ad_group_start_date::text AS start_date,
          asd.ad_group_status AS status,
          (SELECT ad_metrics_synced_at FROM spend_meta) AS ad_metrics_synced_at,
          (SELECT currency_warning FROM spend_meta) AS currency_warning
        FROM adgroup_revenue ar
        LEFT JOIN adgroup_spend asd
          ON asd.id_match = ar.id OR asd.name_match = ar.id
        ORDER BY ar.total_revenue_usd DESC, ar.user_count DESC, ar.id ASC
        LIMIT ${limit}
      `);

      let campaignName: string | null = rows[0]?.campaign_name ?? null;
      let adMetricsSyncedAt: string | null = rows[0]?.ad_metrics_synced_at
        ? new Date(rows[0].ad_metrics_synced_at).toISOString()
        : null;
      let currencyWarning: string | null = rows[0]?.currency_warning ?? null;
      if (rows.length === 0) {
        const [meta] = await app.db.execute<{
          campaign_name: string | null;
          ad_metrics_synced_at: Date | null;
          currency_warning: string | null;
        }>(sql`
          SELECT
            (SELECT MAX(properties->>${dims.campaignNameKey}) FROM ${appUsers}
              WHERE project_id = ${projectId}
                AND (properties->>${dims.campaignIdKey} = ${campaignId} OR properties->>${dims.campaignNameKey} = ${campaignId})) AS campaign_name,
            (SELECT MAX(last_synced_at) FROM ad_adgroup_lifetime
              WHERE project_id = ${projectId} AND network = ${source}) AS ad_metrics_synced_at,
            (SELECT MAX(spend_currency) FROM ad_adgroup_lifetime
              WHERE project_id = ${projectId} AND network = ${source}
                AND spend_currency IS NOT NULL AND spend_currency <> 'USD') AS currency_warning
        `);
        campaignName = meta?.campaign_name ?? null;
        adMetricsSyncedAt = meta?.ad_metrics_synced_at ? new Date(meta.ad_metrics_synced_at).toISOString() : null;
        currencyWarning = meta?.currency_warning ?? null;
      }

      const adGroups = rows.map(toAdsRow);
      const response: AdsAdGroupsResponse = {
        attribution_source: source,
        campaign_id: campaignId,
        campaign_name: campaignName,
        ad_groups: adGroups,
        total_spend_usd: sumSpend(adGroups),
        ad_metrics_synced_at: adMetricsSyncedAt,
        currency_warning: currencyWarning,
      };
      return response;
    },
  );

  // Returns keyword and ad rankings side-by-side — Apple Search Ads attributes
  // each user to one or the other depending on whether the install came from a
  // search keyword or an auto-driven ad placement.
  app.get<{
    Params: { projectId: string; campaignId: string; adGroupId: string };
    Querystring: { attribution_source?: string; app_id?: string; limit?: string };
  }>(
    "/ads/campaigns/:campaignId/ad-groups/:adGroupId/leaves",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const { projectId, campaignId, adGroupId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const source = parseAttributionSource(request.query.attribution_source);
      const dims = ATTRIBUTION_NETWORK_DIMENSIONS[source];
      if (!dims) return reply.code(400).send({ error: "Unsupported attribution_source" });

      const appId = request.query.app_id;
      const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);

      const baseFilter = sql`
        project_id = ${projectId}
          AND properties->>${ATTRIBUTION_SOURCE_PROPERTY} = ${source}
          AND (properties->>${dims.campaignIdKey} = ${campaignId} OR properties->>${dims.campaignNameKey} = ${campaignId})
          AND (properties->>${dims.adGroupIdKey} = ${adGroupId} OR properties->>${dims.adGroupNameKey} = ${adGroupId})
      `;

      // Each leaf row carries the parent campaign + ad-group names via MAX,
      // so we only fall back to a separate parent fetch when both arrays are
      // empty (the user navigated to an ad group with no attributed users).
      // Keywords/ads use the same name-or-id COALESCE bucketing as campaigns
      // so RC-backfilled name-only attributions land alongside SDK-attributed
      // (id+name) ones for the same logical keyword/ad.
      type LeafRow = AdsAggregateRow & {
        campaign_name: string | null;
        ad_group_name: string | null;
      };
      const [keywordRows, adRows] = await Promise.all([
        app.db.execute<LeafRow>(sql`
          SELECT
            COALESCE(properties->>${dims.keywordNameKey}, properties->>${dims.keywordIdKey}) AS id,
            MAX(properties->>${dims.keywordNameKey}) AS name,
            MAX(properties->>${dims.campaignNameKey}) AS campaign_name,
            MAX(properties->>${dims.adGroupNameKey}) AS ad_group_name,
            COUNT(*)::int AS user_count,
            COUNT(*) FILTER (WHERE COALESCE(total_revenue_usd_cents, 0) > 0)::int AS paying_user_count,
            (COALESCE(SUM(total_revenue_usd_cents), 0) / 100.0)::float AS total_revenue_usd
          FROM ${appUsers}
          WHERE ${baseFilter}
            AND (properties ? ${dims.keywordNameKey} OR properties ? ${dims.keywordIdKey})
            ${appFilter(appId)}
          GROUP BY 1
          ORDER BY total_revenue_usd DESC, user_count DESC, id ASC
          LIMIT ${limit}
        `),
        app.db.execute<LeafRow>(sql`
          SELECT
            COALESCE(properties->>${dims.adNameKey}, properties->>${dims.adIdKey}) AS id,
            MAX(properties->>${dims.adNameKey}) AS name,
            MAX(properties->>${dims.campaignNameKey}) AS campaign_name,
            MAX(properties->>${dims.adGroupNameKey}) AS ad_group_name,
            COUNT(*)::int AS user_count,
            COUNT(*) FILTER (WHERE COALESCE(total_revenue_usd_cents, 0) > 0)::int AS paying_user_count,
            (COALESCE(SUM(total_revenue_usd_cents), 0) / 100.0)::float AS total_revenue_usd
          FROM ${appUsers}
          WHERE ${baseFilter}
            AND (properties ? ${dims.adNameKey} OR properties ? ${dims.adIdKey})
            ${appFilter(appId)}
          GROUP BY 1
          ORDER BY total_revenue_usd DESC, user_count DESC, id ASC
          LIMIT ${limit}
        `),
      ]);

      let campaignName = keywordRows[0]?.campaign_name ?? adRows[0]?.campaign_name ?? null;
      let adGroupName = keywordRows[0]?.ad_group_name ?? adRows[0]?.ad_group_name ?? null;
      if (keywordRows.length === 0 && adRows.length === 0) {
        const [parentRow] = await app.db.execute<{ campaign_name: string | null; ad_group_name: string | null }>(sql`
          SELECT
            MAX(properties->>${dims.campaignNameKey}) AS campaign_name,
            MAX(properties->>${dims.adGroupNameKey}) AS ad_group_name
          FROM ${appUsers}
          WHERE project_id = ${projectId}
            AND (properties->>${dims.campaignIdKey} = ${campaignId} OR properties->>${dims.campaignNameKey} = ${campaignId})
            AND (properties->>${dims.adGroupIdKey} = ${adGroupId} OR properties->>${dims.adGroupNameKey} = ${adGroupId})
        `);
        campaignName = parentRow?.campaign_name ?? null;
        adGroupName = parentRow?.ad_group_name ?? null;
      }

      const response: AdsLeavesResponse = {
        attribution_source: source,
        campaign_id: campaignId,
        campaign_name: campaignName,
        ad_group_id: adGroupId,
        ad_group_name: adGroupName,
        keywords: keywordRows.map(toAdsRow),
        ads: adRows.map(toAdsRow),
      };
      return response;
    },
  );

  // Manual refresh: fires single-project RC sync (refreshes lifetime revenue
  // per user) + Apple Ads sync (resolves unresolved ASA IDs to readable names).
  app.post<{ Params: { projectId: string } }>(
    "/ads/sync",
    { preHandler: requirePermission("users:write") },
    async (request, reply) => {
      const { projectId } = request.params;
      const project = await resolveProject(app, projectId, request.auth, reply);
      if (!project) return;

      const roleError = assertTeamRole(request.auth, project.team_id, "admin");
      if (roleError) return reply.code(403).send({ error: roleError });

      const triggeredBy = formatManualTriggeredBy(request.auth);
      const [rcRun, asaRun] = await Promise.all([
        app.jobRunner.trigger("revenuecat_sync", {
          triggeredBy,
          teamId: project.team_id,
          projectId,
          params: { project_id: projectId },
        }),
        app.jobRunner.trigger("apple_ads_sync", {
          triggeredBy,
          teamId: project.team_id,
          projectId,
          params: { project_id: projectId },
        }),
      ]);

      return {
        syncing: true,
        revenuecat_job_run_id: rcRun.id,
        apple_ads_job_run_id: asaRun.id,
      };
    },
  );
}

// Team-scoped sibling — used by dashboard "All projects" view at /dashboard/ads.
// Campaigns are aggregated per (project_id, campaign) so same-named campaigns
// in different ASA orgs / projects stay distinct rows. Drops the `app_id`
// filter — apps are project-scoped so a multi-project app filter is meaningless.
export async function teamAdsRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { team_id?: string; attribution_source?: string; limit?: string };
  }>(
    "/ads/campaigns",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);
      const { team_id } = request.query;

      const teamIds = team_id ? (allTeamIds.includes(team_id) ? [team_id] : []) : allTeamIds;
      const source = parseAttributionSource(request.query.attribution_source);
      const dims = ATTRIBUTION_NETWORK_DIMENSIONS[source];
      if (!dims) return reply.code(400).send({ error: "Unsupported attribution_source" });

      // Caller can't see the requested team — short-circuit before touching
      // the DB. Same shape as a successful "no campaigns yet" response.
      if (teamIds.length === 0) {
        const empty: TeamAdsCampaignsResponse = {
          attribution_source: source,
          campaigns: [],
          total_user_count: 0,
          total_paying_user_count: 0,
          total_revenue_usd: 0,
          total_spend_usd: null,
          revenue_synced_at: null,
          ad_metrics_synced_at: null,
          currency_warning: null,
        };
        return empty;
      }

      const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
      const teamIdList = sql.join(
        teamIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );

      type TeamAdsAggregateRow = AdsAggregateRow & {
        project_id: string;
        revenue_synced_at: Date | null;
        ad_metrics_synced_at: Date | null;
        currency_warning: string | null;
      };
      // Same shape as the project-scoped campaigns query, but groups on
      // (project_id, COALESCE(name, id)) so two ASA orgs with same-named
      // campaigns stay distinct rows. The `team_projects` CTE replaces a
      // separate `SELECT id FROM projects WHERE team_id IN (…)` roundtrip.
      // Position-based `GROUP BY 1, 2` avoids drizzle's parameter-placeholder
      // duplication tripping Postgres's textual-equality check on GROUP BY
      // expressions — same workaround as the project-scoped campaigns query.
      // Spend join is per-(project_id, network) — keeps two projects with the
      // same campaign_id (different ASA orgs) attributed correctly.
      const rows = await app.db.execute<TeamAdsAggregateRow>(sql`
        WITH team_projects AS (
          SELECT id FROM ${projects}
          WHERE team_id IN (${teamIdList}) AND deleted_at IS NULL
        ),
        team_sync AS (
          SELECT MAX(revenue_synced_at) AS synced_at
          FROM ${appUsers}
          WHERE project_id IN (SELECT id FROM team_projects)
        ),
        team_revenue AS (
          SELECT
            project_id::text AS project_id,
            COALESCE(properties->>${dims.campaignNameKey}, properties->>${dims.campaignIdKey}) AS id,
            MAX(properties->>${dims.campaignNameKey}) AS name,
            COUNT(*)::int AS user_count,
            COUNT(*) FILTER (WHERE COALESCE(total_revenue_usd_cents, 0) > 0)::int AS paying_user_count,
            (COALESCE(SUM(total_revenue_usd_cents), 0) / 100.0)::float AS total_revenue_usd
          FROM ${appUsers}
          WHERE project_id IN (SELECT id FROM team_projects)
            AND properties->>${ATTRIBUTION_SOURCE_PROPERTY} = ${source}
            AND (properties ? ${dims.campaignNameKey} OR properties ? ${dims.campaignIdKey})
          GROUP BY 1, 2
        ),
        team_spend AS (
          SELECT
            project_id::text AS project_id,
            campaign_id::text AS id_match,
            campaign_name AS name_match,
            total_spend_usd_cents,
            spend_currency,
            campaign_start_date,
            campaign_status,
            last_synced_at
          FROM ad_campaign_lifetime
          WHERE project_id IN (SELECT id FROM team_projects) AND network = ${source}
        ),
        spend_meta AS (
          SELECT
            MAX(last_synced_at) AS ad_metrics_synced_at,
            MAX(spend_currency) FILTER (WHERE spend_currency IS NOT NULL AND spend_currency <> 'USD') AS currency_warning
          FROM team_spend
        )
        SELECT
          tr.project_id,
          tr.id,
          tr.name,
          tr.user_count,
          tr.paying_user_count,
          tr.total_revenue_usd,
          ts.total_spend_usd_cents,
          ts.spend_currency,
          ts.campaign_start_date::text AS start_date,
          ts.campaign_status AS status,
          (SELECT synced_at FROM team_sync) AS revenue_synced_at,
          (SELECT ad_metrics_synced_at FROM spend_meta) AS ad_metrics_synced_at,
          (SELECT currency_warning FROM spend_meta) AS currency_warning
        FROM team_revenue tr
        LEFT JOIN team_spend ts
          ON ts.project_id = tr.project_id
            AND (ts.id_match = tr.id OR ts.name_match = tr.id)
        ORDER BY tr.total_revenue_usd DESC, tr.user_count DESC, tr.id ASC
        LIMIT ${limit}
      `);

      const campaigns: TeamAdsRow[] = rows.map((row) => ({
        ...toAdsRow(row),
        project_id: row.project_id,
      }));
      const totalUserCount = campaigns.reduce((acc, r) => acc + r.user_count, 0);
      const totalPayingUserCount = campaigns.reduce((acc, r) => acc + r.paying_user_count, 0);
      const totalRevenueUsd = campaigns.reduce((acc, r) => acc + r.total_revenue_usd, 0);
      let revenueSyncedAt: string | null = rows[0]?.revenue_synced_at
        ? new Date(rows[0].revenue_synced_at).toISOString()
        : null;
      let adMetricsSyncedAt: string | null = rows[0]?.ad_metrics_synced_at
        ? new Date(rows[0].ad_metrics_synced_at).toISOString()
        : null;
      let currencyWarning: string | null = rows[0]?.currency_warning ?? null;
      if (rows.length === 0) {
        const [meta] = await app.db.execute<{
          revenue_synced_at: Date | null;
          ad_metrics_synced_at: Date | null;
          currency_warning: string | null;
        }>(sql`
          WITH tp AS (
            SELECT id FROM ${projects}
            WHERE team_id IN (${teamIdList}) AND deleted_at IS NULL
          )
          SELECT
            (SELECT MAX(revenue_synced_at) FROM ${appUsers} WHERE project_id IN (SELECT id FROM tp)) AS revenue_synced_at,
            (SELECT MAX(last_synced_at) FROM ad_campaign_lifetime WHERE project_id IN (SELECT id FROM tp) AND network = ${source}) AS ad_metrics_synced_at,
            (SELECT MAX(spend_currency) FROM ad_campaign_lifetime
              WHERE project_id IN (SELECT id FROM tp) AND network = ${source}
                AND spend_currency IS NOT NULL AND spend_currency <> 'USD') AS currency_warning
        `);
        revenueSyncedAt = meta?.revenue_synced_at ? new Date(meta.revenue_synced_at).toISOString() : null;
        adMetricsSyncedAt = meta?.ad_metrics_synced_at ? new Date(meta.ad_metrics_synced_at).toISOString() : null;
        currencyWarning = meta?.currency_warning ?? null;
      }

      const response: TeamAdsCampaignsResponse = {
        attribution_source: source,
        campaigns,
        total_user_count: totalUserCount,
        total_paying_user_count: totalPayingUserCount,
        total_revenue_usd: totalRevenueUsd,
        total_spend_usd: sumSpend(campaigns),
        revenue_synced_at: revenueSyncedAt,
        ad_metrics_synced_at: adMetricsSyncedAt,
        currency_warning: currencyWarning,
      };
      return response;
    },
  );
}
