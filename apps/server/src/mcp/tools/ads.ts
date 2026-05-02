import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ADS_ATTRIBUTION_SOURCES } from "@owlmetry/shared";
import { callApi, buildQuery } from "../helpers.js";

const attributionSourceSchema = z
  .enum(ADS_ATTRIBUTION_SOURCES as [string, ...string[]])
  .optional()
  .describe(
    "Attribution network. Today only 'apple_search_ads' is populated; defaults to that.",
  );

export function registerAdsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-ad-campaigns", {
    description:
      "Rank advertising campaigns by lifetime USD revenue + spend (ROAS). Aggregates app_users by attribution_source + campaign and joins each user's lifetime RevenueCat revenue (refreshed daily and on every subscription webhook), then LEFT JOINs each campaign's spend / impressions / taps / installs from `ad_campaign_lifetime` (synced daily from the network's reporting API — Apple Search Ads today). Returns user_count, paying_user_count, total_revenue_usd, ARPU, total_spend_usd, roas (revenue/spend), start_date, status per campaign, sorted by revenue desc. `total_spend_usd` and `roas` are null when no integration is connected, no row matches, or the org's reporting currency isn't USD (response carries `currency_warning` in that case). Pass `project_id` for a single project, or `team_id` (without `project_id`) to aggregate across every project in a team — each row then carries `project_id` so you can tell which project owns it.",
    inputSchema: {
      project_id: z
        .string()
        .uuid()
        .optional()
        .describe("The project ID. Mutually exclusive with team_id."),
      team_id: z
        .string()
        .uuid()
        .optional()
        .describe(
          "Team ID — aggregates campaigns across every project in the team. Mutually exclusive with project_id. `app_id` is not honored in this mode.",
        ),
      attribution_source: attributionSourceSchema,
      app_id: z
        .string()
        .uuid()
        .optional()
        .describe("Scope to users acquired into a single app (project mode only)"),
      limit: z.number().int().min(1).max(500).optional().describe("Max campaigns (default 100)"),
    },
  }, async ({ project_id, team_id, ...params }) => {
    if (project_id && team_id) {
      return {
        content: [
          {
            type: "text",
            text: "Error: project_id and team_id are mutually exclusive. Pick one.",
          },
        ],
        isError: true,
      };
    }
    if (!project_id && !team_id) {
      return {
        content: [
          {
            type: "text",
            text: "Error: pass either project_id (single project) or team_id (all projects in a team).",
          },
        ],
        isError: true,
      };
    }
    if (team_id) {
      const { app_id: _ignored, ...teamParams } = params;
      void _ignored;
      return callApi(app, agentKey, {
        method: "GET",
        url: `/v1/ads/campaigns${buildQuery({ team_id, ...teamParams })}`,
      });
    }
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/ads/campaigns${buildQuery(params)}`,
    });
  });

  server.registerTool("list-ad-groups", {
    description:
      "Rank ad groups within a campaign by lifetime USD revenue + spend (ROAS). Same shape as list-ad-campaigns but one level deeper, joined against `ad_adgroup_lifetime`. Each row carries total_spend_usd, roas, start_date, status alongside revenue / users / paying / ARPU.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      campaign_id: z
        .string()
        .describe("Network-specific campaign ID returned by list-ad-campaigns"),
      attribution_source: attributionSourceSchema,
      app_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
  }, async ({ project_id, campaign_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/ads/campaigns/${encodeURIComponent(
        campaign_id,
      )}/ad-groups${buildQuery(params)}`,
    });
  });

  server.registerTool("list-ad-leaves", {
    description:
      "Within a single ad group, list keyword-level and ad-level revenue rankings side-by-side. Returns both `keywords` and `ads` arrays — Apple Search Ads attributes a user to one or the other depending on whether the install came from a search keyword or an auto-driven ad placement.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      campaign_id: z.string(),
      ad_group_id: z.string(),
      attribution_source: attributionSourceSchema,
      app_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
  }, async ({ project_id, campaign_id, ad_group_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/ads/campaigns/${encodeURIComponent(
        campaign_id,
      )}/ad-groups/${encodeURIComponent(ad_group_id)}/leaves${buildQuery(params)}`,
    });
  });

  server.registerTool("sync-ads", {
    description:
      "Trigger a manual refresh of advertising insights for one project. Fires revenuecat_sync (refreshes lifetime revenue per user) AND apple_ads_sync (resolves unresolved ASA IDs to names + pulls campaign / ad-group spend / impressions / taps / installs from Apple's Reports API into ad_campaign_lifetime + ad_adgroup_lifetime, filtered by adamId so only this project's apps' campaigns are stored). Admin-only. The daily cron also runs revenuecat_sync at 03:00 UTC and apple_ads_sync at 04:45 UTC across every project.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
    },
  }, async ({ project_id }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/ads/sync`,
    });
  });
}
