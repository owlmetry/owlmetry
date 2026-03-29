import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, buildQuery } from "../helpers.js";

export function registerFunnelsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-funnels", {
    description: "List all funnel definitions for a project.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
    },
  }, async ({ project_id }) => {
    return callApi(app, agentKey, { method: "GET", url: `/v1/projects/${project_id}/funnels` });
  });

  server.registerTool("get-funnel", {
    description: "Get a funnel definition by slug, including its steps.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      slug: z.string().describe("Funnel slug"),
    },
  }, async ({ project_id, slug }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/funnels/${slug}`,
    });
  });

  server.registerTool("create-funnel", {
    description:
      "Create a funnel definition with ordered steps. Each step has a name and event_filter (matching on step_name and/or screen_name). Max 20 steps. Requires funnels:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      name: z.string().describe("Funnel name"),
      slug: z.string().describe("Funnel slug (lowercase, numbers, hyphens only)"),
      description: z.string().optional().describe("Funnel description"),
      steps: z.array(z.object({
        name: z.string().describe("Step display name"),
        event_filter: z.object({
          step_name: z.string().optional().describe("Match events with this step_name (what devs pass to track())"),
          screen_name: z.string().optional().describe("Match events on this screen"),
        }),
      })).describe("Ordered list of funnel steps (max 20)"),
    },
  }, async ({ project_id, ...body }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/funnels`,
      payload: body,
    });
  });

  server.registerTool("update-funnel", {
    description: "Update a funnel definition. Requires funnels:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      slug: z.string().describe("Funnel slug"),
      name: z.string().optional().describe("New funnel name"),
      description: z.string().optional().describe("New description"),
      steps: z.array(z.object({
        name: z.string(),
        event_filter: z.object({
          step_name: z.string().optional(),
          screen_name: z.string().optional(),
        }),
      })).optional().describe("New step list"),
    },
  }, async ({ project_id, slug, ...body }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/funnels/${slug}`,
      payload: body,
    });
  });

  server.registerTool("delete-funnel", {
    description: "Soft-delete a funnel definition. Requires funnels:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      slug: z.string().describe("Funnel slug to delete"),
    },
  }, async ({ project_id, slug }) => {
    return callApi(app, agentKey, {
      method: "DELETE",
      url: `/v1/projects/${project_id}/funnels/${slug}`,
    });
  });

  server.registerTool("query-funnel", {
    description:
      "Query funnel analytics: conversion rates and drop-off between steps. Supports open (independent) and closed (sequential) modes, grouping by environment, app_version, or experiment variant.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      slug: z.string().describe("Funnel slug"),
      since: z.string().optional().describe("Start time (default: 30 days)"),
      until: z.string().optional().describe("End time"),
      app_id: z.string().uuid().optional().describe("Filter by app"),
      app_version: z.string().optional().describe("Filter by app version"),
      environment: z.string().optional().describe("Filter by environment"),
      experiment: z.string().optional().describe("Filter by experiment (format: name:variant)"),
      mode: z.enum(["open", "closed"]).optional().describe("Funnel mode (default: open)"),
      group_by: z.string().optional().describe("Group by: environment, app_version, or experiment:<name>"),
      data_mode: z.enum(["production", "development", "all"]).optional().describe("Data mode"),
    },
  }, async ({ project_id, slug, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/funnels/${slug}/query${buildQuery(params)}`,
    });
  });
}
