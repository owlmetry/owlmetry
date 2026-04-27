import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REVIEW_STORES } from "@owlmetry/shared";
import { callApi, buildQuery } from "../helpers.js";

export function registerRatingsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-app-ratings", {
    description:
      "List per-country App Store rating aggregates (average + total count, including star-only ratings) for one app. Includes a worldwide weighted-average summary. Pulled daily from iTunes Lookup.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      app_id: z.string().uuid().describe("The app ID (must be an Apple app with a bundle_id)"),
      store: z.enum(REVIEW_STORES).optional().describe("Store to filter by (default 'app_store')"),
    },
  }, async ({ project_id, app_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/apps/${app_id}/ratings${buildQuery(params)}`,
    });
  });

  server.registerTool("list-ratings-by-country", {
    description:
      "Group App Store ratings by country across every app in a project (or a single app via app_id). Weighted average across apps using each storefront's rating count. Sorted by total ratings desc.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      app_id: z.string().uuid().optional().describe("Scope to a single app"),
      store: z.enum(REVIEW_STORES).optional().describe("Store to filter by (default 'app_store')"),
    },
  }, async ({ project_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/ratings/by-country${buildQuery(params)}`,
    });
  });

  server.registerTool("sync-app-ratings", {
    description:
      "Trigger a manual rating sync for every Apple app in a project. Fans out across every Apple iTunes storefront and snapshots per-country ratings. Admin-only. Daily cron at 04:30 UTC also runs this automatically.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
    },
  }, async ({ project_id }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/ratings/sync`,
    });
  });
}
