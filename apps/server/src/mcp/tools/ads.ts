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
      "Rank advertising campaigns by lifetime USD revenue from attributed users. Aggregates app_users by attribution_source + campaign and joins each user's lifetime RevenueCat revenue (refreshed daily and on every subscription webhook). Returns user_count, paying_user_count, total_revenue_usd, ARPU per campaign, sorted by revenue desc.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      attribution_source: attributionSourceSchema,
      app_id: z
        .string()
        .uuid()
        .optional()
        .describe("Scope to users acquired into a single app"),
      limit: z.number().int().min(1).max(500).optional().describe("Max campaigns (default 100)"),
    },
  }, async ({ project_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/ads/campaigns${buildQuery(params)}`,
    });
  });

  server.registerTool("list-ad-groups", {
    description:
      "Rank ad groups within a campaign by lifetime USD revenue. Same shape as list-ad-campaigns but one level deeper.",
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
      "Trigger a manual refresh of advertising insights for one project. Fires both revenuecat_sync (refreshes lifetime revenue per user) and apple_ads_sync (resolves any unresolved ASA IDs to names). Admin-only. The daily cron also runs revenuecat_sync at 03:00 UTC across every project.",
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
