import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, callApiRaw, buildQuery } from "../helpers.js";
import { SUPPORTED_PROVIDER_IDS, type WebhookSetup } from "@owlmetry/shared";

const providerEnum = z.enum(SUPPORTED_PROVIDER_IDS as [string, ...string[]]);

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
    const { body, error } = await callApiRaw(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/integrations`,
      payload: { provider, config },
    });

    if (error) return error;

    const content: Array<{ type: "text"; text: string }> = [
      { type: "text", text: JSON.stringify(body, null, 2) },
    ];

    const webhookSetup = body.webhook_setup as WebhookSetup | undefined;
    if (webhookSetup) {
      content.push({
        type: "text",
        text: [
          "── RevenueCat Webhook Setup ──",
          "Paste these into RevenueCat (Settings → Webhooks → + New Webhook):",
          "",
          `Webhook URL:     ${webhookSetup.webhook_url}`,
          `Authorization:   ${webhookSetup.authorization_header}`,
          `Environment:     ${webhookSetup.environment}`,
          `Events filter:   ${webhookSetup.events_filter}`,
          "",
          "The authorization header contains the webhook secret. It will not be shown again.",
          "",
          "Next step: After the user saves the webhook in RevenueCat, call sync-integration with this project_id to backfill existing subscribers.",
        ].join("\n"),
      });
    }

    return { content };
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
      "Trigger a sync for an integration. Bulk sync (no user_id) queues a background job. Single-user sync (with user_id) is synchronous. Supports providers: 'revenuecat' (subscription data + attribution backfill), 'apple-search-ads' (resolves ASA IDs to campaign/ad group/keyword/ad names).",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      provider: providerEnum.optional().default("revenuecat").describe("Integration provider to sync. Defaults to 'revenuecat' for backwards compatibility."),
      user_id: z.string().optional().describe("Sync a single user (synchronous). Omit for bulk sync (background job)."),
    },
  }, async ({ project_id, provider, user_id }) => {
    const resolvedProvider = provider ?? "revenuecat";
    const url = user_id
      ? `/v1/projects/${project_id}/integrations/${resolvedProvider}/sync/${user_id}`
      : `/v1/projects/${project_id}/integrations/${resolvedProvider}/sync`;
    return callApi(app, agentKey, { method: "POST", url });
  });
}
