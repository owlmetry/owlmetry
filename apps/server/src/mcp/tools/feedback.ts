import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FEEDBACK_STATUSES } from "@owlmetry/shared";
import { callApi, buildQuery } from "../helpers.js";

export function registerFeedbackTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-feedback", {
    description: "List user feedback for a project. Feedback is free-text input submitted by end users via the SDK's OwlFeedbackView or Owl.sendFeedback API. Sorted by most recent first.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      status: z.enum(FEEDBACK_STATUSES).optional().describe("Filter by status"),
      app_id: z.string().uuid().optional().describe("Filter by app"),
      is_dev: z.boolean().optional().describe("Filter by dev/prod (true = dev only)"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().optional().describe("Max results (default 50)"),
    },
  }, async ({ project_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/feedback${buildQuery(params)}`,
    });
  });

  server.registerTool("get-feedback", {
    description: "Get a feedback submission with comments. The session_id on the feedback links to the full session timeline — pass it to query-events to see what the user did before submitting.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      feedback_id: z.string().uuid().describe("The feedback ID"),
    },
  }, async ({ project_id, feedback_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/feedback/${feedback_id}`,
    });
  });

  server.registerTool("update-feedback-status", {
    description: "Update the status of a feedback submission. Statuses: new → in_review → addressed → dismissed (any transition is allowed).",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      feedback_id: z.string().uuid().describe("The feedback ID"),
      status: z.enum(FEEDBACK_STATUSES).describe("The new status"),
    },
  }, async ({ project_id, feedback_id, status }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/feedback/${feedback_id}`,
      payload: { status },
    });
  });

  server.registerTool("add-feedback-comment", {
    description: "Add a comment to a feedback submission. Use this to log investigations, link to issues, or document why you marked it addressed/dismissed.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      feedback_id: z.string().uuid().describe("The feedback ID"),
      body: z.string().describe("The comment text (markdown supported)"),
    },
  }, async ({ project_id, feedback_id, body }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/feedback/${feedback_id}/comments`,
      payload: { body },
    });
  });
}
