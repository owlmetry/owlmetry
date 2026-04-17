import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LOG_LEVELS, ENVIRONMENTS } from "@owlmetry/shared";
import { callApi, callApiRaw, buildQuery } from "../helpers.js";

const DATA_MODES = ["production", "development", "all"] as const;
const ORDER_DIRECTIONS = ["asc", "desc"] as const;

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
      order: z.enum(ORDER_DIRECTIONS).optional().describe("Sort direction by timestamp. Default 'desc' (newest first). Use 'asc' to walk events chronologically — preferred for session timelines and breadcrumb investigations."),
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
      "Build the best possible breadcrumb trail around a target event. If the target has a session_id, pulls the full session; otherwise falls back to a ±window_minutes time window on the same app. Then enriches with cross-app events for the same user in the same project (bounded by the session/window's time range) so backend and client events appear together even without a shared session_id. Results are merged, deduped by id, and sorted ascending by timestamp. Prefer this over query-events when drilling into a specific event. Set compact=true to drop verbose fields and stay under MCP token limits.",
    inputSchema: {
      event_id: z.string().uuid().describe("The target event ID"),
      window_minutes: z.number().optional().default(5).describe("Fallback time window in minutes, used only when the target has no session_id (default: 5)"),
      data_mode: z.enum(DATA_MODES).optional().describe("Data mode (default: production). Set to match the target event's mode."),
      compact: z.boolean().optional().describe("Return a compact event shape (drops custom_attributes, experiments, device metadata)."),
    },
  }, async ({ event_id, window_minutes, data_mode, compact }) => {
    const targetRes = await callApiRaw(app, agentKey, {
      method: "GET",
      url: `/v1/events/${event_id}`,
    });
    if (targetRes.error) return targetRes.error;

    const target = targetRes.body;
    const appId = target.app_id as string;
    const projectId = target.project_id as string | undefined;
    const sessionId = target.session_id as string | undefined;
    const userId = target.user_id as string | undefined;
    const targetTimestamp = target.timestamp as string;

    // Phase A: full session (same app) or ±window fallback.
    const phaseAQuery: Record<string, string | number | boolean | undefined> = {
      app_id: appId,
      limit: 1000,
      data_mode,
    };
    if (sessionId) {
      phaseAQuery.session_id = sessionId;
    } else {
      const t = new Date(targetTimestamp).getTime();
      const windowMs = (window_minutes ?? 5) * 60 * 1000;
      phaseAQuery.since = new Date(t - windowMs).toISOString();
      phaseAQuery.until = new Date(t + windowMs).toISOString();
      if (userId) phaseAQuery.user_id = userId;
    }

    const phaseARes = await callApiRaw(app, agentKey, {
      method: "GET",
      url: `/v1/events${buildQuery(phaseAQuery)}`,
    });
    if (phaseARes.error) return phaseARes.error;
    const phaseAEvents = (phaseARes.body.events as Array<Record<string, unknown>> | undefined) ?? [];

    // Phase B: project-wide events for the same user, bounded by Phase A's time range.
    let phaseBEvents: Array<Record<string, unknown>> = [];
    if (userId && projectId) {
      const timestamps = phaseAEvents
        .map((e) => new Date(e.timestamp as string).getTime())
        .filter((n) => Number.isFinite(n));
      const targetMs = new Date(targetTimestamp).getTime();
      const earliestMs = timestamps.length ? Math.min(...timestamps, targetMs) : targetMs;
      const latestMs = timestamps.length ? Math.max(...timestamps, targetMs) : targetMs;

      const phaseBRes = await callApiRaw(app, agentKey, {
        method: "GET",
        url: `/v1/events${buildQuery({
          project_id: projectId,
          user_id: userId,
          since: new Date(earliestMs).toISOString(),
          until: new Date(latestMs).toISOString(),
          limit: 1000,
          data_mode,
        })}`,
      });
      if (phaseBRes.error) return phaseBRes.error;
      phaseBEvents = (phaseBRes.body.events as Array<Record<string, unknown>> | undefined) ?? [];
    }

    // Merge target + Phase A + Phase B, dedupe by id, sort ascending by timestamp.
    const byId = new Map<string, Record<string, unknown>>();
    for (const e of [target, ...phaseAEvents, ...phaseBEvents]) {
      const id = e.id as string | undefined;
      if (id && !byId.has(id)) byId.set(id, e);
    }
    const merged = Array.from(byId.values()).sort((a, b) => {
      const ta = new Date(a.timestamp as string).getTime();
      const tb = new Date(b.timestamp as string).getTime();
      return ta - tb;
    });
    const shaped = compact ? merged.map(compactEvent) : merged;

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          events: shaped,
          target_event_id: event_id,
          total: shaped.length,
        }, null, 2),
      }],
    };
  });
}
