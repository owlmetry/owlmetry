import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LOG_LEVELS, ENVIRONMENTS } from "@owlmetry/shared";
import { callApi, callApiRaw, buildQuery } from "../helpers.js";

const DATA_MODES = ["production", "development", "all"] as const;

const COMPACT_FIELDS = [
  "id",
  "timestamp",
  "level",
  "message",
  "screen_name",
  "source_module",
  "user_id",
  "session_id",
  "environment",
  "app_version",
  "is_dev",
] as const;

function compactEvent(event: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of COMPACT_FIELDS) {
    if (event[field] !== undefined && event[field] !== null) {
      result[field] = event[field];
    }
  }
  return result;
}

export function registerEventsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("query-events", {
    description:
      "Query analytics events. Pass session_id to reconstruct a full user session timeline — the preferred tool for drilling into an issue's occurrences (see get-issue, whose occurrences include session_id). Defaults to last 24 hours. Supports filtering by project, app, level, user, session, environment, screen, and data mode. Returns cursor-paginated results. Set compact=true to drop verbose fields (custom_attributes, experiments, device metadata) and stay under MCP token limits.",
    inputSchema: {
      project_id: z.string().uuid().optional().describe("Filter by project"),
      app_id: z.string().uuid().optional().describe("Filter by app (takes precedence over project_id)"),
      level: z.enum(LOG_LEVELS).optional().describe("Filter by log level"),
      user_id: z.string().optional().describe("Filter by user ID"),
      session_id: z.string().uuid().optional().describe("Filter by session ID — use this with a session_id from get-issue occurrences to reconstruct the full session"),
      environment: z.enum(ENVIRONMENTS).optional().describe("Filter by environment"),
      screen_name: z.string().optional().describe("Filter by screen name"),
      since: z.string().optional().describe("Start time (relative like '1h', '7d' or ISO 8601)"),
      until: z.string().optional().describe("End time (relative or ISO 8601)"),
      cursor: z.string().optional().describe("Pagination cursor from previous response"),
      limit: z.number().optional().describe("Max results (default 50, max 1000)"),
      data_mode: z.enum(DATA_MODES).optional().describe("Filter by data mode (default: production)"),
      compact: z.boolean().optional().describe("Return a compact event shape (drops custom_attributes, experiments, device metadata). Recommended for session timelines to avoid MCP token overflow."),
    },
  }, async (params) => {
    const { compact, ...apiParams } = params;
    if (!compact) {
      return callApi(app, agentKey, {
        method: "GET",
        url: `/v1/events${buildQuery(apiParams)}`,
      });
    }
    const res = await callApiRaw(app, agentKey, {
      method: "GET",
      url: `/v1/events${buildQuery(apiParams)}`,
    });
    if (res.error) return res.error;
    const events = (res.body.events as Array<Record<string, unknown>> | undefined) ?? [];
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          events: events.map(compactEvent),
          cursor: res.body.cursor,
          has_more: res.body.has_more,
        }, null, 2),
      }],
    };
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
      "Retrieve a target event and surrounding context events from the same app and user within a time window. Use when you don't have a session_id, or to see cross-session activity near a timestamp. For single-session drill-down, prefer query-events with session_id. Set compact=true to drop verbose fields and stay under MCP token limits.",
    inputSchema: {
      event_id: z.string().uuid().describe("The target event ID"),
      window_minutes: z.number().optional().default(5).describe("Time window in minutes around the event (default: 5)"),
      data_mode: z.enum(DATA_MODES).optional().describe("Data mode (default: production). Set to match the target event's mode."),
      compact: z.boolean().optional().describe("Return a compact event shape for both target and context (drops custom_attributes, experiments, device metadata)."),
    },
  }, async ({ event_id, window_minutes, data_mode, compact }) => {
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

    const events = (contextRes.body.events as Array<Record<string, unknown>> | undefined) ?? [];
    const shapedTarget = compact ? compactEvent(target) : target;
    const shapedContext = compact ? events.map(compactEvent) : events;
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ target: shapedTarget, context: shapedContext, total_context: shapedContext.length }, null, 2),
      }],
    };
  });
}
