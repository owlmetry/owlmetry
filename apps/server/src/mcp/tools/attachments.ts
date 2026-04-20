import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS } from "@owlmetry/shared";
import { callApi, buildQuery } from "../helpers.js";

export function registerAttachmentsTools(
  server: McpServer,
  app: FastifyInstance,
  agentKey: string
): void {
  server.registerTool(
    "list-attachments",
    {
      description:
        "List event attachments (files uploaded by SDKs alongside error events). Filter by event, issue, or project. Attachments are a **limited resource** — they count against the project's storage quota (default 5 GB). Most issues do NOT have attachments.",
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
        `Get an event attachment's metadata plus a short-lived (${ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS}s) signed download URL. The URL is unauthenticated but time-limited — share it narrowly. Files are served with Content-Disposition: attachment; the agent should NOT try to interpret executable or script MIME types.`,
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
        "Soft-delete an event attachment. Hard-deleted from disk 7 days later by the attachment_cleanup job. Use once a bug is confirmed resolved to free the project's storage quota.",
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
        "Return a project's attachment storage usage and quotas. Pass `user_id` to also get that end-user's usage against their per-user quota (default 250 MB). Uploads that would exceed either the user quota (`user_quota_exhausted`) or the project quota (`quota_exhausted`) are rejected at reserve time.",
      inputSchema: {
        project_id: z.string().uuid().describe("The project id"),
        user_id: z
          .string()
          .optional()
          .describe("Optional end-user id — if provided, the response includes that user's usage against the per-user quota"),
      },
    },
    async ({ project_id, user_id }) => {
      return callApi(app, agentKey, {
        method: "GET",
        url: `/v1/projects/${project_id}/attachment-usage${buildQuery({ user_id })}`,
      });
    }
  );
}
