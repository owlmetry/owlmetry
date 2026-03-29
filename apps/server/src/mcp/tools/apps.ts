import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, buildQuery } from "../helpers.js";

export function registerAppsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-apps", {
    description: "List all apps accessible to this agent. Optionally filter by team_id.",
    inputSchema: {
      team_id: z.string().uuid().optional().describe("Filter by team ID"),
    },
  }, async ({ team_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/apps${buildQuery({ team_id })}`,
    });
  });

  server.registerTool("get-app", {
    description: "Get an app by ID, including its client_key for SDK configuration.",
    inputSchema: {
      app_id: z.string().uuid().describe("The app ID"),
    },
  }, async ({ app_id }) => {
    return callApi(app, agentKey, { method: "GET", url: `/v1/apps/${app_id}` });
  });

  server.registerTool("create-app", {
    description:
      "Create a new app under a project. Returns a client_key for SDK use. Platforms: apple, android, web, backend. bundle_id is required for non-backend platforms and is immutable after creation. Requires apps:write permission.",
    inputSchema: {
      name: z.string().describe("App name"),
      platform: z.enum(["apple", "android", "web", "backend"]).describe("Target platform"),
      project_id: z.string().uuid().describe("Parent project ID"),
      bundle_id: z.string().optional().describe("Bundle identifier (required for non-backend platforms, immutable)"),
    },
  }, async ({ name, platform, project_id, bundle_id }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: "/v1/apps",
      payload: { name, platform, project_id, ...(bundle_id !== undefined ? { bundle_id } : {}) },
    });
  });

  server.registerTool("update-app", {
    description: "Update an app's name. Requires apps:write permission.",
    inputSchema: {
      app_id: z.string().uuid().describe("The app ID"),
      name: z.string().describe("New app name"),
    },
  }, async ({ app_id, name }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/apps/${app_id}`,
      payload: { name },
    });
  });

  server.registerTool("list-app-users", {
    description: "List users for a specific app. Supports search, anonymous/real filtering, and pagination.",
    inputSchema: {
      app_id: z.string().uuid().describe("The app ID"),
      search: z.string().optional().describe("Search by user ID"),
      is_anonymous: z.enum(["true", "false"]).optional().describe("Filter by anonymous status"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().optional().describe("Max results (default 50, max 1000)"),
    },
  }, async ({ app_id, search, is_anonymous, cursor, limit }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/apps/${app_id}/users${buildQuery({ search, is_anonymous, cursor, limit })}`,
    });
  });
}
