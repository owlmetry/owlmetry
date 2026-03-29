import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, buildQuery } from "../helpers.js";

export function registerEventsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("query-events", {
    description:
      "Query analytics events. Defaults to last 24 hours. Supports filtering by project, app, level, user, session, environment, screen, and data mode. Returns cursor-paginated results.",
    inputSchema: {
      project_id: z.string().uuid().optional().describe("Filter by project"),
      app_id: z.string().uuid().optional().describe("Filter by app (takes precedence over project_id)"),
      level: z.enum(["info", "debug", "warn", "error"]).optional().describe("Filter by log level"),
      user_id: z.string().optional().describe("Filter by user ID"),
      session_id: z.string().uuid().optional().describe("Filter by session ID"),
      environment: z.string().optional().describe("Filter by environment (ios, ipados, macos, android, web, backend)"),
      screen_name: z.string().optional().describe("Filter by screen name"),
      since: z.string().optional().describe("Start time (relative like '1h', '7d' or ISO 8601)"),
      until: z.string().optional().describe("End time (relative or ISO 8601)"),
      cursor: z.string().optional().describe("Pagination cursor from previous response"),
      limit: z.number().optional().describe("Max results (default 50, max 1000)"),
      data_mode: z.enum(["production", "development", "all"]).optional().describe("Filter by data mode (default: production)"),
    },
  }, async (params) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/events${buildQuery(params)}`,
    });
  });

  server.registerTool("get-event", {
    description: "Get a single event by ID with full details.",
    inputSchema: {
      event_id: z.string().uuid().describe("The event ID"),
    },
  }, async ({ event_id }) => {
    return callApi(app, agentKey, { method: "GET", url: `/v1/events/${event_id}` });
  });

  server.registerTool("investigate-event", {
    description:
      "Retrieve a specific event and its surrounding context events from the same app and user within a time window. Use this to understand what happened before and after a notable event.",
    inputSchema: {
      event_id: z.string().uuid().describe("The target event ID"),
      window_minutes: z.number().optional().default(5).describe("Time window in minutes around the event (default: 5)"),
    },
  }, async ({ event_id, window_minutes }) => {
    // Step 1: Get the target event
    const targetResult = await callApi(app, agentKey, {
      method: "GET",
      url: `/v1/events/${event_id}`,
    });

    if (targetResult.isError) return targetResult;

    const target = JSON.parse(targetResult.content[0].text);
    const timestamp = new Date(target.timestamp);
    const windowMs = (window_minutes ?? 5) * 60 * 1000;
    const since = new Date(timestamp.getTime() - windowMs).toISOString();
    const until = new Date(timestamp.getTime() + windowMs).toISOString();

    // Step 2: Query surrounding events
    const query = buildQuery({
      app_id: target.app_id,
      ...(target.user_id ? { user_id: target.user_id } : {}),
      since,
      until,
      limit: 200,
    });

    const contextResult = await callApi(app, agentKey, {
      method: "GET",
      url: `/v1/events${query}`,
    });

    if (contextResult.isError) return contextResult;

    const context = JSON.parse(contextResult.content[0].text);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ target, context: context.events, total_context: context.events?.length ?? 0 }, null, 2),
      }],
    };
  });
}
