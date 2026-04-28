import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_REVIEW_RESPONSE_LENGTH, REVIEW_STORES } from "@owlmetry/shared";
import { callApi, buildQuery } from "../helpers.js";

export function registerReviewsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-reviews", {
    description:
      "List App Store / Play Store reviews for a project. Apple reviews are pulled via the App Store Connect customerReviews API (requires the project to have an App Store Connect integration configured). Distinct from in-app feedback. Sorted by most recent first. Filter by app, store, rating, country, or developer-response presence.",
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

  server.registerTool("respond-to-review", {
    description:
      "Reply to an App Store review. Sends the response to App Store Connect — it becomes publicly visible on the App Store listing once Apple publishes it. If a reply already exists, it is replaced (Apple has no PATCH for review responses, so this internally deletes-then-creates). Requires the project to have an active App Store Connect integration whose API key has Customer Support role or higher. Only confirm and call this when the user has explicitly approved the exact response text — the published reply is publicly visible.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      review_id: z.string().uuid().describe("The review ID (Owlmetry's UUID, not the App Store's external ID)"),
      body: z
        .string()
        .min(1)
        .max(MAX_REVIEW_RESPONSE_LENGTH)
        .describe(`Reply text (max ${MAX_REVIEW_RESPONSE_LENGTH} characters — Apple's limit)`),
    },
  }, async ({ project_id, review_id, body }) => {
    return callApi(app, agentKey, {
      method: "PUT",
      url: `/v1/projects/${project_id}/reviews/${review_id}/response`,
      payload: { body },
    });
  });

  server.registerTool("delete-review-response", {
    description:
      "⚠️ Destructive: removes the developer response from the public App Store listing. This is a real Apple-side mutation and is irrecoverable — the only way back is to post a new reply. Use only when the user has explicitly asked you to delete the reply.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      review_id: z.string().uuid().describe("The review ID"),
    },
  }, async ({ project_id, review_id }) => {
    return callApi(app, agentKey, {
      method: "DELETE",
      url: `/v1/projects/${project_id}/reviews/${review_id}/response`,
    });
  });
}
