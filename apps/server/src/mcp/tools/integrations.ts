import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, buildQuery } from "../helpers.js";

export function registerIntegrationsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-providers", {
    description: "List supported integration providers (e.g., RevenueCat).",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
    },
  }, async ({ project_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/integrations/providers`,
    });
  });

  server.registerTool("list-integrations", {
    description: "List configured integrations for a project.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
    },
  }, async ({ project_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/integrations`,
    });
  });

  server.registerTool("add-integration", {
    description:
      "Add an integration to a project. Config fields depend on the provider (use list-providers to see required fields). Requires integrations:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      provider: z.string().describe("Provider name (e.g., 'revenuecat')"),
      config: z.record(z.string(), z.unknown()).describe("Provider-specific configuration (e.g., { api_key, webhook_secret })"),
    },
  }, async ({ project_id, provider, config }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/integrations`,
      payload: { provider, config },
    });
  });

  server.registerTool("update-integration", {
    description: "Update an integration's config or enabled state. Requires integrations:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      provider: z.string().describe("Provider name"),
      config: z.record(z.string(), z.unknown()).optional().describe("Updated config fields"),
      enabled: z.boolean().optional().describe("Enable or disable the integration"),
    },
  }, async ({ project_id, provider, ...body }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/integrations/${provider}`,
      payload: body,
    });
  });

  server.registerTool("remove-integration", {
    description: "Remove an integration from a project. Requires integrations:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      provider: z.string().describe("Provider name to remove"),
    },
  }, async ({ project_id, provider }) => {
    return callApi(app, agentKey, {
      method: "DELETE",
      url: `/v1/projects/${project_id}/integrations/${provider}`,
    });
  });

  server.registerTool("sync-integration", {
    description:
      "Trigger a sync for an integration. Bulk sync (no user_id) queues a background job. Single-user sync (with user_id) is synchronous. Currently only supports RevenueCat.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      user_id: z.string().optional().describe("Sync a single user (synchronous). Omit for bulk sync (background job)."),
    },
  }, async ({ project_id, user_id }) => {
    const url = user_id
      ? `/v1/projects/${project_id}/integrations/revenuecat/sync/${user_id}`
      : `/v1/projects/${project_id}/integrations/revenuecat/sync`;
    return callApi(app, agentKey, { method: "POST", url });
  });
}
