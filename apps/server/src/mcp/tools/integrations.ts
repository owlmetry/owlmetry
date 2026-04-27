import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, callApiRaw, buildQuery } from "../helpers.js";
import { SUPPORTED_PROVIDER_IDS, INTEGRATION_PROVIDER_IDS, type WebhookSetup } from "@owlmetry/shared";

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
      "Add an integration to a project. For 'revenuecat' pass { api_key }; Owlmetry generates the webhook_secret. For 'apple-search-ads' pass an empty config ({}); Owlmetry generates the EC P-256 keypair, stores the private half server-side, and returns the public key — relay that to the user so they can upload it at ads.apple.com → Account Settings → User Management (on an \"API Account Read Only\" user). DO NOT ask the user for a private key — we never accept one. After the user uploads the public key and Apple returns client_id/team_id/key_id, call update-integration with those three IDs, then update-integration again with org_id to finalize. For 'app-store-connect' pass { issuer_id, key_id, private_key_p8 } — the user downloads the .p8 from App Store Connect → Users and Access → Integrations (Customer Support role on an Individual Key) and pastes its full PEM contents. Owlmetry redacts the .p8 after save and never returns it; to rotate, call update-integration with a fresh private_key_p8. Use list-providers for field reference. Requires integrations:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      provider: z.string().describe("Provider name ('revenuecat', 'apple-search-ads', or 'app-store-connect')"),
      config: z.record(z.string(), z.unknown()).describe("Provider config. revenuecat: { api_key }. apple-search-ads: {} (server generates keypair). app-store-connect: { issuer_id, key_id, private_key_p8 }."),
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

    if (provider === INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS) {
      const cfg = (body.config ?? {}) as Record<string, unknown>;
      const publicKey = typeof cfg.public_key_pem === "string" ? cfg.public_key_pem : "";
      content.push({
        type: "text",
        text: [
          "── Apple Search Ads: Public Key (upload to Apple) ──",
          "Relay this public key to the user — they paste it into ads.apple.com under an \"API Account Read Only\" user.",
          "",
          publicKey,
          "",
          "Next steps:",
          "  1. User → ads.apple.com → Account Settings → User Management. Invite (or reuse) an \"API Account Read Only\" user.",
          "  2. On that user's API tab, paste the public key above. Apple returns client_id, team_id, key_id.",
          `  3. Call update-integration with { project_id: '${project_id}', provider: 'apple-search-ads', config: { client_id, team_id, key_id } }.`,
          `  4. Then call update-integration again with { org_id } (the numeric \"Account ID\" shown in the ads.apple.com profile menu) to finalize. The integration enables automatically when all four IDs are set.`,
        ].join("\n"),
      });
    }

    if (provider === INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT) {
      content.push({
        type: "text",
        text: [
          "── App Store Connect: integration created ──",
          "Credentials are stored. The .p8 contents have been redacted from this response and will not be returned again.",
          "",
          `Next: call sync-integration with { project_id: '${project_id}', provider: 'app-store-connect' } to ingest reviews. Or test-connection via the dashboard / 'integrations test' CLI command first to confirm Apple accepts the credentials.`,
        ].join("\n"),
      });
    }

    return { content };
  });

  server.registerTool("update-integration", {
    description:
      "Update an integration's config or enabled state. For apple-search-ads, valid config keys are client_id, team_id, key_id, org_id — the integration auto-enables when all four are present, so do NOT pass enabled. For app-store-connect, valid config keys are issuer_id, key_id, private_key_p8 — omit private_key_p8 to keep the existing .p8 (the server merges patches on top of existing config). enabled is also derived from config completeness for app-store-connect, so do NOT pass enabled. Server-managed keys (private_key_pem, public_key_pem, webhook_secret) are always stripped from input — the server generates and rotates those. Requires integrations:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      provider: z.string().describe("Provider name"),
      config: z.record(z.string(), z.unknown()).optional().describe("Updated config fields (merged with existing; omit a key to keep its existing value)"),
      enabled: z.boolean().optional().describe("Enable or disable the integration. Ignored for apple-search-ads and app-store-connect (derived from config completeness)."),
    },
  }, async ({ project_id, provider, ...body }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/integrations/${provider}`,
      payload: body,
    });
  });

  server.registerTool("copy-integration", {
    description:
      "Copy an integration from one project to another within the same team — one-step clone, no manual setup on the target. For apple-search-ads the full config (keypair + client/team/key/org IDs) is duplicated verbatim and the response includes a live connection_test result confirming Apple still accepts the credentials. Target is enabled immediately, no Apple-side work needed. For revenuecat the api_key is copied verbatim but a fresh webhook_secret is generated on the target (returned in webhook_setup — paste into RevenueCat if you want webhooks delivered to the copy's project). Credentials are duplicated (not shared) — rotating the source does not update copies. Requires integrations:write permission and admin role on the target team.",
    inputSchema: {
      source_project_id: z.string().uuid().describe("Project that already has the integration configured"),
      target_project_id: z.string().uuid().describe("Project that will receive a copy of the credentials"),
      provider: providerEnum.describe("Integration provider to copy (revenuecat | apple-search-ads | app-store-connect)"),
    },
  }, async ({ source_project_id, target_project_id, provider }) => {
    const { body, error } = await callApiRaw(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${target_project_id}/integrations/copy-from/${source_project_id}`,
      payload: { provider },
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
          "── RevenueCat Webhook Setup (target project) ──",
          "A fresh webhook secret was generated for the target project. If you want RevenueCat to deliver events here,",
          "add a separate webhook in RevenueCat with these values:",
          "",
          `Webhook URL:     ${webhookSetup.webhook_url}`,
          `Authorization:   ${webhookSetup.authorization_header}`,
          `Environment:     ${webhookSetup.environment}`,
          `Events filter:   ${webhookSetup.events_filter}`,
          "",
          "The source project's webhook continues to work unchanged.",
        ].join("\n"),
      });
    }

    const connectionTest = body.connection_test as
      | { ok: true; orgs?: Array<{ org_id: number; org_name: string }>; apps?: Array<{ id: string; name: string; bundle_id: string }> }
      | { ok: false; error: string; message: string }
      | undefined;
    if (connectionTest) {
      if (connectionTest.ok) {
        if (connectionTest.orgs) {
          const orgsList = connectionTest.orgs.map((o) => `  ${o.org_name} (orgId ${o.org_id})`).join("\n");
          content.push({
            type: "text",
            text: [
              "── Apple Search Ads connection test: OK ──",
              "Apple accepted the copied credentials. The integration is active on the target project — no further setup needed.",
              "",
              "Accessible orgs:",
              orgsList,
            ].join("\n"),
          });
        } else if (connectionTest.apps) {
          const appsList = connectionTest.apps.map((a) => `  ${a.name} (${a.bundle_id})`).join("\n");
          content.push({
            type: "text",
            text: [
              "── App Store Connect connection test: OK ──",
              "Apple accepted the copied credentials. The integration is active on the target project — no further setup needed.",
              "",
              "Accessible apps:",
              appsList,
            ].join("\n"),
          });
        }
      } else {
        content.push({
          type: "text",
          text: [
            "── Connection test: FAILED ──",
            `Error: ${connectionTest.error}`,
            `Message: ${connectionTest.message}`,
            "",
            "The copy is saved but Apple rejected the credentials. Likely causes: source project's API key was revoked, or Apple's auth endpoint is transiently down. Rerun the test from the dashboard once resolved.",
          ].join("\n"),
        });
      }
    }

    return { content };
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
      "Trigger a sync for an integration. Bulk sync (no user_id) queues a background job. Single-user sync (with user_id) is synchronous and only supported by 'revenuecat' and 'apple-search-ads'. Supports providers: 'revenuecat' (subscription data + attribution backfill), 'apple-search-ads' (resolves ASA IDs to campaign/ad group/keyword/ad names), 'app-store-connect' (pulls App Store reviews via the customerReviews endpoint — bulk only, no user_id).",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      provider: providerEnum.optional().default("revenuecat").describe("Integration provider to sync. Defaults to 'revenuecat' for backwards compatibility."),
      user_id: z.string().optional().describe("Sync a single user (synchronous). Omit for bulk sync (background job). Not supported for app-store-connect."),
    },
  }, async ({ project_id, provider, user_id }) => {
    const resolvedProvider = provider ?? "revenuecat";
    const url = user_id
      ? `/v1/projects/${project_id}/integrations/${resolvedProvider}/sync/${user_id}`
      : `/v1/projects/${project_id}/integrations/${resolvedProvider}/sync`;
    return callApi(app, agentKey, { method: "POST", url });
  });
}
