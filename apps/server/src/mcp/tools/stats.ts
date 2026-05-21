import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  STATS_KINDS,
  STATS_GRAINS,
  STATS_MAX_WINDOW_DAYS,
  STATS_MAX_WINDOW_HOURS,
} from "@owlmetry/shared";
import { callApi, buildQuery } from "../helpers.js";

const DATA_MODES = ["production", "development", "all"] as const;

export function registerStatsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool(
    "query-stats-bucketed",
    {
      description:
        "Query time-series rollups for events, users, sessions, metric / funnel completions, or questionnaire responses. " +
          "Daily grain powers sparkline-style charts and year-long trends; hourly grain powers intraday views. " +
          "Backed by pre-aggregated tables that are retained indefinitely — these survive raw-event retention pruning. " +
          "Buckets are UTC; the current in-progress bucket is excluded by default so a partial day/hour can't show as a dip. " +
          "Pass either `project_id` or `team_id` (not both); for funnel_completions / metric_completions / questionnaire_responses, " +
          "`slug` narrows to a single definition.",
      inputSchema: {
        kind: z
          .enum(STATS_KINDS)
          .describe(
            "Series type. events/users/sessions all read events_daily|events_hourly with different columns; " +
              "metric_completions filters to phase='complete'; funnel_completions filters to each funnel's terminal step.",
          ),
        grain: z.enum(STATS_GRAINS).describe("Bucket granularity"),
        project_id: z.string().uuid().optional().describe("Project ID (mutually exclusive with team_id)"),
        team_id: z.string().uuid().optional().describe("Team ID (mutually exclusive with project_id)"),
        app_id: z.string().uuid().optional().describe("Narrow to a single app"),
        days: z
          .number()
          .int()
          .min(1)
          .max(STATS_MAX_WINDOW_DAYS)
          .optional()
          .describe(
            `Trailing UTC days (grain=daily; default 30, max ${STATS_MAX_WINDOW_DAYS}). Ignored if from/to set.`,
          ),
        hours: z
          .number()
          .int()
          .min(1)
          .max(STATS_MAX_WINDOW_HOURS)
          .optional()
          .describe(
            `Trailing UTC hours (grain=hourly; default 24, max ${STATS_MAX_WINDOW_HOURS}). Ignored if from/to set.`,
          ),
        from: z.string().optional().describe("Explicit start (YYYY-MM-DD for daily, ISO 8601 for hourly). Pair with to."),
        to: z.string().optional().describe("Explicit end (inclusive)."),
        excluding_current: z
          .boolean()
          .optional()
          .describe("Drop the in-progress bucket. Default true; set false to include it."),
        data_mode: z.enum(DATA_MODES).optional().describe("Filter by data mode (default production)"),
        slug: z
          .string()
          .optional()
          .describe("Narrow to one metric / funnel / questionnaire slug (kind-dependent)"),
      },
    },
    async ({ kind, grain, project_id, team_id, ...rest }) => {
      if (!project_id && !team_id) {
        return {
          content: [{ type: "text", text: "Error: one of project_id or team_id is required" }],
          isError: true,
        };
      }
      if (project_id && team_id) {
        return {
          content: [{ type: "text", text: "Error: project_id and team_id are mutually exclusive" }],
          isError: true,
        };
      }

      const query = buildQuery({
        team_id: project_id ? undefined : team_id,
        app_id: rest.app_id,
        days: rest.days,
        hours: rest.hours,
        from: rest.from,
        to: rest.to,
        excluding_current: rest.excluding_current === false ? "false" : undefined,
        data_mode: rest.data_mode,
        slug: rest.slug,
      });

      const path = project_id
        ? `/v1/projects/${project_id}/stats/${kind}/${grain}${query}`
        : `/v1/stats/${kind}/${grain}${query}`;

      return callApi(app, agentKey, { method: "GET", url: path });
    },
  );
}
