import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { callApi } from "../helpers.js";

export function registerAuthTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("whoami", {
    description:
      "Check authentication and return the identity, team, and permissions of the current API key.",
    inputSchema: {},
  }, async () => {
    return callApi(app, agentKey, { method: "GET", url: "/v1/auth/whoami" });
  });
}
