import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, buildQuery } from "../helpers.js";

export function registerProjectsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-projects", {
    description: "List all projects accessible to this agent. Optionally filter by team_id.",
    inputSchema: {
      team_id: z.string().uuid().optional().describe("Filter by team ID"),
    },
  }, async ({ team_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects${buildQuery({ team_id })}`,
    });
  });

  server.registerTool("get-project", {
    description: "Get a project by ID, including its list of apps.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
    },
  }, async ({ project_id }) => {
    return callApi(app, agentKey, { method: "GET", url: `/v1/projects/${project_id}` });
  });

  server.registerTool("create-project", {
    description:
      "Create a new project. Requires projects:write permission and admin role.",
    inputSchema: {
      team_id: z.string().uuid().describe("The team to create the project in"),
      name: z.string().describe("Project name"),
      slug: z.string().describe("URL-friendly slug (lowercase, hyphens)"),
      retention_days_events: z.number().int().min(1).max(3650).optional()
        .describe("Days to retain events (default: 120)"),
      retention_days_metrics: z.number().int().min(1).max(3650).optional()
        .describe("Days to retain metric events (default: 365)"),
      retention_days_funnels: z.number().int().min(1).max(3650).optional()
        .describe("Days to retain funnel events (default: 365)"),
    },
  }, async ({ team_id, name, slug, retention_days_events, retention_days_metrics, retention_days_funnels }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: "/v1/projects",
      payload: { team_id, name, slug, retention_days_events, retention_days_metrics, retention_days_funnels },
    });
  });

  server.registerTool("update-project", {
    description: "Update a project's name or data retention policies. Requires projects:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      name: z.string().optional().describe("New project name"),
      retention_days_events: z.number().int().min(1).max(3650).nullable().optional()
        .describe("Days to retain events (null = use default 120)"),
      retention_days_metrics: z.number().int().min(1).max(3650).nullable().optional()
        .describe("Days to retain metric events (null = use default 365)"),
      retention_days_funnels: z.number().int().min(1).max(3650).nullable().optional()
        .describe("Days to retain funnel events (null = use default 365)"),
    },
  }, async ({ project_id, name, retention_days_events, retention_days_metrics, retention_days_funnels }) => {
    const payload: Record<string, unknown> = {};
    if (name !== undefined) payload.name = name;
    if (retention_days_events !== undefined) payload.retention_days_events = retention_days_events;
    if (retention_days_metrics !== undefined) payload.retention_days_metrics = retention_days_metrics;
    if (retention_days_funnels !== undefined) payload.retention_days_funnels = retention_days_funnels;
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}`,
      payload,
    });
  });
}
