import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi } from "../helpers.js";

export function registerAuthTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("whoami", {
    description:
      "Check authentication and return the identity, team, and permissions of the current API key.",
    inputSchema: {},
  }, async () => {
    return callApi(app, agentKey, { method: "GET", url: "/v1/auth/whoami" });
  });

  server.registerTool("create-import-key", {
    description:
      "Create an import API key for bulk-importing historical events into an app. " +
      "The key is shown once — save it immediately. " +
      "Use with POST /v1/import to send up to 1000 events per batch with no timestamp restrictions.",
    inputSchema: {
      app_id: z.string().uuid().describe("The app ID to scope the import key to"),
      name: z.string().optional().describe("Display name for the key (default: 'Import Key')"),
    },
  }, async ({ app_id, name }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: "/v1/auth/keys",
      payload: {
        name: name || "Import Key",
        key_type: "import",
        app_id,
      },
    });
  });
}
