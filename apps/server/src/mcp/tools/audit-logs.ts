import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, buildQuery } from "../helpers.js";

export function registerAuditLogsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-audit-logs", {
    description:
      "List audit log entries for a team. Records who performed what action on which resource. Requires audit_logs:read permission or admin role.",
    inputSchema: {
      team_id: z.string().uuid().describe("The team ID"),
      resource_type: z.string().optional().describe("Filter by resource type (app, project, api_key, team, etc.)"),
      resource_id: z.string().uuid().optional().describe("Filter by resource ID"),
      actor_id: z.string().uuid().optional().describe("Filter by actor ID"),
      action: z.enum(["create", "update", "delete"]).optional().describe("Filter by action"),
      since: z.string().optional().describe("Start time"),
      until: z.string().optional().describe("End time"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().optional().describe("Max results (default 50)"),
    },
  }, async ({ team_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/teams/${team_id}/audit-logs${buildQuery(params)}`,
    });
  });
}
