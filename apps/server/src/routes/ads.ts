import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { appUsers } from "@owlmetry/db";
import {
  ATTRIBUTION_NETWORK_DIMENSIONS,
  ATTRIBUTION_SOURCE_PROPERTY,
  ADS_ATTRIBUTION_SOURCES,
  type AdsRow,
  type AdsCampaignsResponse,
  type AdsAdGroupsResponse,
  type AdsLeavesResponse,
} from "@owlmetry/shared";
import { requirePermission, assertTeamRole } from "../middleware/auth.js";
import { resolveProject } from "../utils/project.js";
import { formatManualTriggeredBy } from "../utils/integrations.js";

const DEFAULT_ATTRIBUTION_SOURCE = "apple_search_ads";

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
} & Record<string, unknown>;

function toAdsRow(row: AdsAggregateRow): AdsRow {
  const userCount = Number(row.user_count) || 0;
  const totalRevenue = Number(row.total_revenue_usd) || 0;
  return {
    id: row.id,
    name: row.name,
    user_count: userCount,
    paying_user_count: Number(row.paying_user_count) || 0,
    total_revenue_usd: totalRevenue,
    arpu: userCount > 0 ? totalRevenue / userCount : 0,
  };
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
  // GET /v1/projects/:projectId/ads/campaigns
  // Ranked by total_revenue_usd DESC, user_count DESC, id ASC.
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

      // Postgres compares GROUP BY expressions textually — two parameter
      // placeholders for the same value count as different expressions and
      // trip "column must appear in GROUP BY". Position-based `GROUP BY 1`
      // avoids that and makes the rewrite trivial when adding more dimensions.
      const rows = await app.db.execute<AdsAggregateRow>(sql`
        SELECT
          properties->>${dims.campaignIdKey} AS id,
          MAX(properties->>${dims.campaignNameKey}) AS name,
          COUNT(*)::int AS user_count,
          COUNT(*) FILTER (WHERE COALESCE(total_revenue_usd_cents, 0) > 0)::int AS paying_user_count,
          (COALESCE(SUM(total_revenue_usd_cents), 0) / 100.0)::float AS total_revenue_usd
        FROM ${appUsers}
        WHERE project_id = ${projectId}
          AND properties->>${ATTRIBUTION_SOURCE_PROPERTY} = ${source}
          AND properties ? ${dims.campaignIdKey}
          ${appFilter(appId)}
        GROUP BY 1
        ORDER BY total_revenue_usd DESC, user_count DESC, id ASC
        LIMIT ${limit}
      `);

      const campaigns = rows.map(toAdsRow);
      const totalUserCount = campaigns.reduce((acc, r) => acc + r.user_count, 0);
      const totalPayingUserCount = campaigns.reduce((acc, r) => acc + r.paying_user_count, 0);
      const totalRevenueUsd = campaigns.reduce((acc, r) => acc + r.total_revenue_usd, 0);

      // Project-level "as of" timestamp — the most recent revenue_synced_at
      // across users in this project. Surfaces as a single header on the
      // dashboard so the team knows when their numbers were last refreshed.
      const [syncRow] = await app.db.execute<{ synced_at: Date | null }>(sql`
        SELECT MAX(revenue_synced_at) AS synced_at
        FROM ${appUsers}
        WHERE project_id = ${projectId}
      `);

      const response: AdsCampaignsResponse = {
        attribution_source: source,
        campaigns,
        total_user_count: totalUserCount,
        total_paying_user_count: totalPayingUserCount,
        total_revenue_usd: totalRevenueUsd,
        revenue_synced_at: syncRow?.synced_at ? new Date(syncRow.synced_at).toISOString() : null,
      };
      return response;
    },
  );

  // GET /v1/projects/:projectId/ads/campaigns/:campaignId/ad-groups
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

      const rows = await app.db.execute<AdsAggregateRow>(sql`
        SELECT
          properties->>${dims.adGroupIdKey} AS id,
          MAX(properties->>${dims.adGroupNameKey}) AS name,
          COUNT(*)::int AS user_count,
          COUNT(*) FILTER (WHERE COALESCE(total_revenue_usd_cents, 0) > 0)::int AS paying_user_count,
          (COALESCE(SUM(total_revenue_usd_cents), 0) / 100.0)::float AS total_revenue_usd
        FROM ${appUsers}
        WHERE project_id = ${projectId}
          AND properties->>${ATTRIBUTION_SOURCE_PROPERTY} = ${source}
          AND properties->>${dims.campaignIdKey} = ${campaignId}
          AND properties ? ${dims.adGroupIdKey}
          ${appFilter(appId)}
        GROUP BY 1
        ORDER BY total_revenue_usd DESC, user_count DESC, id ASC
        LIMIT ${limit}
      `);

      const [campaignRow] = await app.db.execute<{ name: string | null }>(sql`
        SELECT MAX(properties->>${dims.campaignNameKey}) AS name
        FROM ${appUsers}
        WHERE project_id = ${projectId}
          AND properties->>${dims.campaignIdKey} = ${campaignId}
        LIMIT 1
      `);

      const response: AdsAdGroupsResponse = {
        attribution_source: source,
        campaign_id: campaignId,
        campaign_name: campaignRow?.name ?? null,
        ad_groups: rows.map(toAdsRow),
      };
      return response;
    },
  );

  // GET /v1/projects/:projectId/ads/campaigns/:campaignId/ad-groups/:adGroupId/leaves
  // Returns both keyword and ad rankings within the ad group; the dashboard
  // renders them side-by-side so operators see both attribution dimensions.
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
          AND properties->>${dims.campaignIdKey} = ${campaignId}
          AND properties->>${dims.adGroupIdKey} = ${adGroupId}
      `;

      const [keywordRows, adRows, parentRow] = await Promise.all([
        app.db.execute<AdsAggregateRow>(sql`
          SELECT
            properties->>${dims.keywordIdKey} AS id,
            MAX(properties->>${dims.keywordNameKey}) AS name,
            COUNT(*)::int AS user_count,
            COUNT(*) FILTER (WHERE COALESCE(total_revenue_usd_cents, 0) > 0)::int AS paying_user_count,
            (COALESCE(SUM(total_revenue_usd_cents), 0) / 100.0)::float AS total_revenue_usd
          FROM ${appUsers}
          WHERE ${baseFilter}
            AND properties ? ${dims.keywordIdKey}
            ${appFilter(appId)}
          GROUP BY 1
          ORDER BY total_revenue_usd DESC, user_count DESC, id ASC
          LIMIT ${limit}
        `),
        app.db.execute<AdsAggregateRow>(sql`
          SELECT
            properties->>${dims.adIdKey} AS id,
            MAX(properties->>${dims.adNameKey}) AS name,
            COUNT(*)::int AS user_count,
            COUNT(*) FILTER (WHERE COALESCE(total_revenue_usd_cents, 0) > 0)::int AS paying_user_count,
            (COALESCE(SUM(total_revenue_usd_cents), 0) / 100.0)::float AS total_revenue_usd
          FROM ${appUsers}
          WHERE ${baseFilter}
            AND properties ? ${dims.adIdKey}
            ${appFilter(appId)}
          GROUP BY 1
          ORDER BY total_revenue_usd DESC, user_count DESC, id ASC
          LIMIT ${limit}
        `),
        app.db.execute<{ campaign_name: string | null; ad_group_name: string | null }>(sql`
          SELECT
            MAX(properties->>${dims.campaignNameKey}) AS campaign_name,
            MAX(properties->>${dims.adGroupNameKey}) AS ad_group_name
          FROM ${appUsers}
          WHERE project_id = ${projectId}
            AND properties->>${dims.campaignIdKey} = ${campaignId}
            AND properties->>${dims.adGroupIdKey} = ${adGroupId}
          LIMIT 1
        `),
      ]);

      const response: AdsLeavesResponse = {
        attribution_source: source,
        campaign_id: campaignId,
        campaign_name: parentRow[0]?.campaign_name ?? null,
        ad_group_id: adGroupId,
        ad_group_name: parentRow[0]?.ad_group_name ?? null,
        keywords: keywordRows.map(toAdsRow),
        ads: adRows.map(toAdsRow),
      };
      return response;
    },
  );

  // POST /v1/projects/:projectId/ads/sync — admin-only manual refresh.
  // Triggers a single-project RC sync (which now also writes lifetime revenue)
  // and an Apple Ads sync (which resolves any unresolved ASA IDs to names).
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
