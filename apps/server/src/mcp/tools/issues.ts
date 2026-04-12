import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ISSUE_STATUSES } from "@owlmetry/shared";
import { callApi, buildQuery } from "../helpers.js";

export function registerIssuesTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-issues", {
    description: "List issues for a project. Issues are error events grouped by fingerprint. Sorted by severity (unique affected users).",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      status: z.enum(ISSUE_STATUSES).optional().describe("Filter by status"),
      app_id: z.string().uuid().optional().describe("Filter by app"),
      is_dev: z.boolean().optional().describe("Filter by dev/prod (true = dev only)"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().optional().describe("Max results (default 50)"),
    },
  }, async ({ project_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/issues${buildQuery(params)}`,
    });
  });

  server.registerTool("get-issue", {
    description: "Get details of a specific issue, including occurrences (sessions affected), comments, and fingerprints.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      issue_id: z.string().uuid().describe("The issue ID"),
    },
  }, async ({ project_id, issue_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/issues/${issue_id}`,
    });
  });

  server.registerTool("resolve-issue", {
    description: "Mark an issue as resolved. Optionally specify the app version where the fix was applied.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      issue_id: z.string().uuid().describe("The issue ID"),
      version: z.string().optional().describe("App version where the fix was applied"),
    },
  }, async ({ project_id, issue_id, version }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/issues/${issue_id}`,
      payload: { status: "resolved", resolved_at_version: version },
    });
  });

  server.registerTool("silence-issue", {
    description: "Silence an issue to stop notifications. Occurrences are still tracked.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      issue_id: z.string().uuid().describe("The issue ID"),
    },
  }, async ({ project_id, issue_id }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/issues/${issue_id}`,
      payload: { status: "silenced" },
    });
  });

  server.registerTool("reopen-issue", {
    description: "Reopen a resolved or silenced issue.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      issue_id: z.string().uuid().describe("The issue ID"),
    },
  }, async ({ project_id, issue_id }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/issues/${issue_id}`,
      payload: { status: "new" },
    });
  });

  server.registerTool("claim-issue", {
    description: "Claim an issue by setting its status to in_progress. Use this when investigating or working on a fix.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      issue_id: z.string().uuid().describe("The issue ID"),
    },
  }, async ({ project_id, issue_id }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/issues/${issue_id}`,
      payload: { status: "in_progress" },
    });
  });

  server.registerTool("merge-issues", {
    description: "Merge a source issue into a target issue. All occurrences, fingerprints, and comments are moved to the target. The source is deleted.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      target_issue_id: z.string().uuid().describe("The target issue ID (survives the merge)"),
      source_issue_id: z.string().uuid().describe("The source issue ID (will be deleted)"),
    },
  }, async ({ project_id, target_issue_id, source_issue_id }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/issues/${target_issue_id}/merge`,
      payload: { source_issue_id },
    });
  });

  server.registerTool("list-issue-comments", {
    description: "List comments on an issue. Comments provide investigation context from users and agents.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      issue_id: z.string().uuid().describe("The issue ID"),
    },
  }, async ({ project_id, issue_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/issues/${issue_id}/comments`,
    });
  });

  server.registerTool("add-issue-comment", {
    description: "Add a comment to an issue. Use this to document investigations, fixes, or context for future reference.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      issue_id: z.string().uuid().describe("The issue ID"),
      body: z.string().describe("The comment text (markdown supported)"),
    },
  }, async ({ project_id, issue_id, body }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/issues/${issue_id}/comments`,
      payload: { body },
    });
  });
}
