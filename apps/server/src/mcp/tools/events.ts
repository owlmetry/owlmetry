import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LOG_LEVELS, ENVIRONMENTS } from "@owlmetry/shared";
import { callApi, callApiRaw, buildQuery } from "../helpers.js";

const DATA_MODES = ["production", "development", "all"] as const;

export function registerEventsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("query-events", {
    description:
      "Query analytics events. Defaults to last 24 hours. Supports filtering by project, app, level, user, session, environment, screen, and data mode. Returns cursor-paginated results.",
    inputSchema: {
      project_id: z.string().uuid().optional().describe("Filter by project"),
      app_id: z.string().uuid().optional().describe("Filter by app (takes precedence over project_id)"),
      level: z.enum(LOG_LEVELS).optional().describe("Filter by log level"),
      user_id: z.string().optional().describe("Filter by user ID"),
      session_id: z.string().uuid().optional().describe("Filter by session ID"),
      environment: z.enum(ENVIRONMENTS).optional().describe("Filter by environment"),
      screen_name: z.string().optional().describe("Filter by screen name"),
      since: z.string().optional().describe("Start time (relative like '1h', '7d' or ISO 8601)"),
      until: z.string().optional().describe("End time (relative or ISO 8601)"),
      cursor: z.string().optional().describe("Pagination cursor from previous response"),
      limit: z.number().optional().describe("Max results (default 50, max 1000)"),
      data_mode: z.enum(DATA_MODES).optional().describe("Filter by data mode (default: production)"),
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
      data_mode: z.enum(DATA_MODES).optional().describe("Data mode (default: production). Set to match the target event's mode."),
    },
  }, async ({ event_id, window_minutes, data_mode }) => {
    const targetRes = await callApiRaw(app, agentKey, {
      method: "GET",
      url: `/v1/events/${event_id}`,
    });
    if (targetRes.error) return targetRes.error;

    const target = targetRes.body;
    const timestamp = new Date(target.timestamp as string);
    const windowMs = (window_minutes ?? 5) * 60 * 1000;
    const since = new Date(timestamp.getTime() - windowMs).toISOString();
    const until = new Date(timestamp.getTime() + windowMs).toISOString();

    const contextRes = await callApiRaw(app, agentKey, {
      method: "GET",
      url: `/v1/events${buildQuery({
        app_id: target.app_id as string,
        ...(target.user_id ? { user_id: target.user_id as string } : {}),
        since,
        until,
        limit: 200,
        data_mode,
      })}`,
    });
    if (contextRes.error) return contextRes.error;

    const events = contextRes.body.events as unknown[];
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ target, context: events, total_context: events?.length ?? 0 }, null, 2),
      }],
    };
  });
}
