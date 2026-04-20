import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, buildQuery } from "../helpers.js";

// Attachment tooling for agents. Always use sparingly — attachments consume the
// project's finite storage quota. Agents should NEVER upload files speculatively;
// tool descriptions emphasise this.
export function registerAttachmentsTools(
  server: McpServer,
  app: FastifyInstance,
  agentKey: string
): void {
  server.registerTool(
    "list-attachments",
    {
      description:
        "List event attachments (files uploaded by SDKs alongside error events for debugging). Filter by event, issue, or project. Attachments are a **limited resource** — only SDKs upload them, and they count against the project's storage quota (default 5 GB). Most issues do NOT have attachments; only ones where the user/SDK opted to attach a file (e.g. a failed-conversion input image).",
      inputSchema: {
        project_id: z.string().uuid().optional().describe("Filter by project"),
        event_id: z.string().uuid().optional().describe("Filter by a specific event id"),
        event_client_id: z
          .string()
          .uuid()
          .optional()
          .describe("Filter by SDK-generated client event id (matches events.client_event_id)"),
        issue_id: z.string().uuid().optional().describe("Filter by issue id"),
        cursor: z.string().optional().describe("Pagination cursor from previous response"),
        limit: z.number().optional().describe("Max results (default 50, max 200)"),
      },
    },
    async (params) => {
      return callApi(app, agentKey, {
        method: "GET",
        url: `/v1/attachments${buildQuery(params)}`,
      });
    }
  );

  server.registerTool(
    "get-attachment",
    {
      description:
        "Get an event attachment's metadata plus a short-lived (60s) signed download URL. The URL is unauthenticated but time-limited — share it narrowly. Files are served with Content-Disposition: attachment; the agent should NOT try to interpret executable or script MIME types.",
      inputSchema: {
        attachment_id: z.string().uuid().describe("The attachment id"),
      },
    },
    async ({ attachment_id }) => {
      return callApi(app, agentKey, {
        method: "GET",
        url: `/v1/attachments/${attachment_id}`,
      });
    }
  );

  server.registerTool(
    "delete-attachment",
    {
      description:
        "Soft-delete an event attachment. It stays recoverable for 7 days before the attachment_cleanup job hard-deletes it from disk. Use this when you have confirmed a bug is resolved and the attached file is no longer needed — it frees the project's storage quota.",
      inputSchema: {
        attachment_id: z.string().uuid().describe("The attachment id"),
      },
    },
    async ({ attachment_id }) => {
      return callApi(app, agentKey, {
        method: "DELETE",
        url: `/v1/attachments/${attachment_id}`,
      });
    }
  );

  server.registerTool(
    "get-project-attachment-usage",
    {
      description:
        "Return a project's current attachment storage usage alongside its configured quota and per-file limit. Use this before asking a user to re-run a scenario with attachments enabled — if the project is near its quota, new uploads will fail with `quota_exhausted`.",
      inputSchema: {
        project_id: z.string().uuid().describe("The project id"),
      },
    },
    async ({ project_id }) => {
      return callApi(app, agentKey, {
        method: "GET",
        url: `/v1/projects/${project_id}/attachment-usage`,
      });
    }
  );
}
