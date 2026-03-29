import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, buildQuery } from "../helpers.js";

export function registerJobsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-jobs", {
    description: "List background job runs for a team. Supports filtering by type, status, project, and date range.",
    inputSchema: {
      team_id: z.string().uuid().describe("The team ID"),
      job_type: z.string().optional().describe("Filter by job type (e.g., revenuecat_sync)"),
      status: z.enum(["pending", "running", "success", "failed"]).optional().describe("Filter by status"),
      project_id: z.string().uuid().optional().describe("Filter by project"),
      since: z.string().optional().describe("Start time"),
      until: z.string().optional().describe("End time"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().optional().describe("Max results (default 50)"),
    },
  }, async ({ team_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/teams/${team_id}/jobs${buildQuery(params)}`,
    });
  });

  server.registerTool("get-job", {
    description: "Get details of a specific job run, including progress and result.",
    inputSchema: {
      run_id: z.string().uuid().describe("The job run ID"),
    },
  }, async ({ run_id }) => {
    return callApi(app, agentKey, { method: "GET", url: `/v1/jobs/${run_id}` });
  });

  server.registerTool("trigger-job", {
    description:
      "Trigger a background job. Only one instance per job type (per project) can be running at a time. Requires jobs:write permission.",
    inputSchema: {
      team_id: z.string().uuid().describe("The team ID"),
      job_type: z.string().describe("Job type (e.g., revenuecat_sync)"),
      project_id: z.string().uuid().optional().describe("Project ID (required for project-scoped jobs)"),
      params: z.record(z.string(), z.unknown()).optional().describe("Job-specific parameters"),
      notify: z.boolean().optional().describe("Send email notification on completion"),
    },
  }, async ({ team_id, ...body }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/teams/${team_id}/jobs/trigger`,
      payload: body,
    });
  });

  server.registerTool("cancel-job", {
    description: "Cancel a running job. Only works on running jobs. Cancellation is cooperative.",
    inputSchema: {
      run_id: z.string().uuid().describe("The job run ID to cancel"),
    },
  }, async ({ run_id }) => {
    return callApi(app, agentKey, { method: "POST", url: `/v1/jobs/${run_id}/cancel` });
  });
}
