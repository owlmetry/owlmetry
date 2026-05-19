import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { QUESTIONNAIRE_RESPONSE_STATUSES } from "@owlmetry/shared";
import { callApi, buildQuery } from "../helpers.js";

// Structural-only schema for the MCP tool — the server's
// validateQuestionnaireSchema (packages/shared/src/questionnaires.ts) is the
// authoritative validator and runs on every create/update, so MCP doesn't
// re-state per-field rules and risk drift.
const fullSchema = z.object({
  version: z.literal(1),
  questions: z.array(z.record(z.string(), z.unknown())).min(1).max(30),
});

export function registerQuestionnaireTools(
  server: McpServer,
  app: FastifyInstance,
  agentKey: string,
): void {
  server.registerTool("list-questionnaires", {
    description:
      "List structured questionnaire definitions. Questionnaires are multi-question surveys (text, single/multi choice, rating, NPS) shown in-app via the Swift SDK's view modifier — complementary to single-message feedback. Each row carries response_count + last_response_at + project_id. Pass `project_id` for a single project, or `team_id` for every questionnaire across every accessible project in the team (mutually exclusive).",
    inputSchema: {
      project_id: z.string().uuid().optional().describe("The project ID (mutually exclusive with team_id)"),
      team_id: z.string().uuid().optional().describe("The team ID — lists across all accessible projects (mutually exclusive with project_id)"),
      app_id: z.string().uuid().optional().describe("Filter by app (only with project_id)"),
      is_active: z.boolean().optional().describe("Filter by active flag"),
      cursor: z.string().optional().describe("Pagination cursor (only with project_id)"),
      limit: z.number().optional().describe("Max results (default 50 for project; up to 500 for team)"),
    },
  }, async ({ project_id, team_id, ...params }) => {
    if (!project_id && !team_id) {
      return { content: [{ type: "text", text: "Error: one of project_id or team_id is required" }], isError: true };
    }
    if (project_id && team_id) {
      return { content: [{ type: "text", text: "Error: project_id and team_id are mutually exclusive" }], isError: true };
    }
    if (team_id) {
      const { app_id: _ignoredAppId, cursor: _ignoredCursor, ...teamParams } = params;
      void _ignoredAppId;
      void _ignoredCursor;
      return callApi(app, agentKey, {
        method: "GET",
        url: `/v1/questionnaires${buildQuery({ team_id, ...teamParams })}`,
      });
    }
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/questionnaires${buildQuery(params)}`,
    });
  });

  server.registerTool("get-questionnaire", {
    description:
      "Get a questionnaire definition with its schema (the list of questions) and rolled-up response_count + last_response_at.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      questionnaire_id: z.string().uuid().describe("The questionnaire ID"),
    },
  }, async ({ project_id, questionnaire_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/questionnaires/${questionnaire_id}`,
    });
  });

  server.registerTool("create-questionnaire", {
    description:
      "Create a new questionnaire definition. The slug becomes immutable after creation — the SDK references it to fetch + present the survey. Schema validates inline (every question id must match /^[a-z0-9_]{1,32}$/, choice options 2–20 entries, rating scale fixed at 5, NPS implicit 0–10).",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      slug: z.string().min(1).max(64).describe("URL-safe slug, immutable after creation"),
      name: z.string().min(1).max(200).describe("Human name shown in dashboard"),
      description: z.string().max(2000).optional().describe("Optional description"),
      schema: fullSchema.describe("The schema with questions"),
      app_id: z.string().uuid().optional().describe("Pin to a single app (omit for project-wide)"),
      is_active: z.boolean().optional().describe("Defaults to true"),
    },
  }, async ({ project_id, ...payload }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/questionnaires`,
      payload,
    });
  });

  server.registerTool("update-questionnaire", {
    description:
      "Update a questionnaire's name, description, schema, app_id pinning, or is_active flag. Slug is immutable. Editing the schema is allowed at any time — each response stores its own schema_snapshot so historical data still renders correctly.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      questionnaire_id: z.string().uuid().describe("The questionnaire ID"),
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      schema: fullSchema.optional(),
      app_id: z.string().uuid().nullable().optional(),
      is_active: z.boolean().optional(),
    },
  }, async ({ project_id, questionnaire_id, ...payload }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/questionnaires/${questionnaire_id}`,
      payload,
    });
  });

  server.registerTool("delete-questionnaire", {
    description:
      "⚠️ User-only — agent keys get 403. Soft-deletes a questionnaire. Existing responses are preserved (questionnaire_id has ON DELETE RESTRICT) but the questionnaire stops accepting new responses immediately.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      questionnaire_id: z.string().uuid().describe("The questionnaire ID"),
    },
  }, async ({ project_id, questionnaire_id }) => {
    return callApi(app, agentKey, {
      method: "DELETE",
      url: `/v1/projects/${project_id}/questionnaires/${questionnaire_id}`,
    });
  });

  server.registerTool("list-questionnaire-responses", {
    description:
      "List responses for a questionnaire. Each response carries the answer map plus the schema_snapshot it was submitted against. Filter by status, app, dev/prod, cursor.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      questionnaire_id: z.string().uuid().describe("The questionnaire ID"),
      status: z.enum(QUESTIONNAIRE_RESPONSE_STATUSES).optional(),
      app_id: z.string().uuid().optional(),
      is_dev: z.boolean().optional(),
      data_mode: z.enum(["production", "development", "all"]).optional(),
      cursor: z.string().optional(),
      limit: z.number().optional(),
    },
  }, async ({ project_id, questionnaire_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/questionnaires/${questionnaire_id}/responses${buildQuery(params)}`,
    });
  });

  server.registerTool("get-questionnaire-response", {
    description:
      "Get a single response with comments. session_id links to the full user session — pass to query-events for context.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      questionnaire_id: z.string().uuid().describe("The questionnaire ID"),
      response_id: z.string().uuid().describe("The response ID"),
    },
  }, async ({ project_id, questionnaire_id, response_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/questionnaires/${questionnaire_id}/responses/${response_id}`,
    });
  });

  server.registerTool("update-questionnaire-response-status", {
    description:
      "Update the status of a response (new → in_review → addressed → dismissed; any transition allowed). Used to triage responses without comment-thread churn.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      questionnaire_id: z.string().uuid().describe("The questionnaire ID"),
      response_id: z.string().uuid().describe("The response ID"),
      status: z.enum(QUESTIONNAIRE_RESPONSE_STATUSES).describe("The new status"),
    },
  }, async ({ project_id, questionnaire_id, response_id, status }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}/questionnaires/${questionnaire_id}/responses/${response_id}`,
      payload: { status },
    });
  });

  server.registerTool("add-questionnaire-response-comment", {
    description: "Add a comment to a response. Use to log investigations or flag insights for teammates.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      questionnaire_id: z.string().uuid().describe("The questionnaire ID"),
      response_id: z.string().uuid().describe("The response ID"),
      body: z.string().describe("The comment text (markdown supported)"),
    },
  }, async ({ project_id, questionnaire_id, response_id, body }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: `/v1/projects/${project_id}/questionnaires/${questionnaire_id}/responses/${response_id}/comments`,
      payload: { body },
    });
  });

  server.registerTool("get-questionnaire-analytics", {
    description:
      "Pre-aggregated per-question distribution. For each question: text → 10 most recent answers; single/multi_choice → counts per option; rating → 1–5 bucket counts + average; nps → 0–10 bucket counts + detractor/passive/promoter split + score.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      questionnaire_id: z.string().uuid().describe("The questionnaire ID"),
      is_dev: z.boolean().optional(),
      data_mode: z.enum(["production", "development", "all"]).optional(),
    },
  }, async ({ project_id, questionnaire_id, ...params }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects/${project_id}/questionnaires/${questionnaire_id}/analytics${buildQuery(params)}`,
    });
  });
}
