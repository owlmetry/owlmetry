import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, buildQuery } from "../helpers.js";

export function registerMetricsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-metrics", {
    description: "List all metric definitions for a project.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
    },
  }, async ({ project_id }) => {
    return callApi(app, agentKey, { method: "GET", url: `/v1/projects/${project_id}/metrics` });
  });

  server.registerTool("get-metric", {
    description: "Get a metric definition by slug.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      slug: z.string().describe("Metric slug"),
    },
  }, async ({ project_id, slug }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/metrics/${slug}`,
    });
  });

  server.registerTool("create-metric", {
    description:
      "Create a metric definition. The definition must exist before SDKs emit events for this slug. Slugs: lowercase, numbers, hyphens only. Requires metrics:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      name: z.string().describe("Human-readable metric name"),
      slug: z.string().describe("Metric slug (lowercase, numbers, hyphens only)"),
      description: z.string().optional().describe("Metric description"),
      documentation: z.string().optional().describe("Extended documentation"),
      schema_definition: z.record(z.string(), z.unknown()).optional().describe("Schema definition for metric attributes"),
      aggregation_rules: z.record(z.string(), z.unknown()).optional().describe("Aggregation rules"),
    },
  }, async ({ project_id, ...body }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/metrics`,
      payload: body,
    });
  });

  server.registerTool("update-metric", {
    description: "Update a metric definition. Requires metrics:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      slug: z.string().describe("Metric slug"),
      name: z.string().optional().describe("New metric name"),
      description: z.string().optional().describe("New description"),
      documentation: z.string().optional().describe("New documentation"),
      schema_definition: z.record(z.string(), z.unknown()).optional().describe("New schema definition"),
      aggregation_rules: z.record(z.string(), z.unknown()).optional().describe("New aggregation rules"),
    },
  }, async ({ project_id, slug, ...body }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/metrics/${slug}`,
      payload: body,
    });
  });

  server.registerTool("delete-metric", {
    description: "Soft-delete a metric definition. Requires metrics:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      slug: z.string().describe("Metric slug to delete"),
    },
  }, async ({ project_id, slug }) => {
    return callApi(app, agentKey, {
      method: "DELETE",
      url: `/v1/projects/${project_id}/metrics/${slug}`,
    });
  });

  server.registerTool("query-metric", {
    description:
      "Query aggregated metric statistics: count, avg/p50/p95/p99 duration, error rate. Supports grouping by app, version, environment, device, or time bucket.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      slug: z.string().describe("Metric slug"),
      since: z.string().optional().describe("Start time (relative or ISO 8601, default: 24h)"),
      until: z.string().optional().describe("End time"),
      app_id: z.string().uuid().optional().describe("Filter by app"),
      app_version: z.string().optional().describe("Filter by app version"),
      device_model: z.string().optional().describe("Filter by device model"),
      os_version: z.string().optional().describe("Filter by OS version"),
      user_id: z.string().optional().describe("Filter by user"),
      environment: z.string().optional().describe("Filter by environment"),
      group_by: z.string().optional().describe("Group by: time:hour, time:day, time:week, app_id, app_version, device_model, os_version, environment"),
      data_mode: z.enum(["production", "development", "all"]).optional().describe("Data mode (default: production)"),
    },
  }, async ({ project_id, slug, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/metrics/${slug}/query${buildQuery(params)}`,
    });
  });

  server.registerTool("list-metric-events", {
    description:
      "List raw metric events for a specific metric slug. Useful for debugging individual operations.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      slug: z.string().describe("Metric slug"),
      phase: z.enum(["start", "complete", "fail", "cancel", "record"]).optional().describe("Filter by phase"),
      tracking_id: z.string().uuid().optional().describe("Filter by tracking ID"),
      user_id: z.string().optional().describe("Filter by user"),
      environment: z.string().optional().describe("Filter by environment"),
      since: z.string().optional().describe("Start time (default: 24h)"),
      until: z.string().optional().describe("End time"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().optional().describe("Max results (default 50, max 1000)"),
      data_mode: z.enum(["production", "development", "all"]).optional().describe("Data mode"),
    },
  }, async ({ project_id, slug, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/metrics/${slug}/events${buildQuery(params)}`,
    });
  });
}
