import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REVIEW_STORES } from "@owlmetry/shared";
import { callApi, buildQuery } from "../helpers.js";

export function registerReviewsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-reviews", {
    description:
      "List public App Store / Play Store reviews for a project. These are scraped from the stores (currently Apple App Store via the iTunes RSS feed across all storefronts) — distinct from in-app feedback. Sorted by most recent first. Filter by app, store, rating, country, or developer-response presence.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      app_id: z.string().uuid().optional().describe("Filter by app"),
      store: z.enum(REVIEW_STORES).optional().describe("Filter by store"),
      rating: z.number().int().min(1).max(5).optional().describe("Exact rating (1-5)"),
      rating_lte: z.number().int().min(1).max(5).optional().describe("Rating <= this value"),
      rating_gte: z.number().int().min(1).max(5).optional().describe("Rating >= this value"),
      country_code: z.string().length(2).optional().describe("ISO country code (lower-case, e.g. 'us')"),
      has_developer_response: z.boolean().optional().describe("Only reviews with (true) or without (false) a dev response"),
      search: z.string().optional().describe("Free-text search within title + body"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().optional().describe("Max results (default 50)"),
    },
  }, async ({ project_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/reviews${buildQuery(params)}`,
    });
  });

  server.registerTool("get-review", {
    description:
      "Get a single store review by ID, including reviewer name, body, country, app version, and any developer response.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      review_id: z.string().uuid().describe("The review ID"),
    },
  }, async ({ project_id, review_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/reviews/${review_id}`,
    });
  });

  server.registerTool("list-reviews-by-country", {
    description:
      "Group reviews by country and return the count + average rating per country. Useful for spotting regional sentiment differences. Optionally scope to a single app or store.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      app_id: z.string().uuid().optional().describe("Scope to a single app"),
      store: z.enum(REVIEW_STORES).optional().describe("Scope to a single store"),
    },
  }, async ({ project_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/reviews/by-country${buildQuery(params)}`,
    });
  });
}
