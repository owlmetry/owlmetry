import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { QUESTIONNAIRE_RESPONSE_STATUSES } from "@owlmetry/shared";
import { callApi, buildQuery } from "../helpers.js";

// Zod shapes for the questionnaire schema, mirroring the shared TS types.
const choiceOptionSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(100),
});
const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    id: z.string().min(1).max(32),
    title: z.string().min(1).max(200),
    subtitle: z.string().max(500).optional(),
    required: z.boolean(),
    placeholder: z.string().max(200).optional(),
    multiline: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("single_choice"),
    id: z.string().min(1).max(32),
    title: z.string().min(1).max(200),
    subtitle: z.string().max(500).optional(),
    required: z.boolean(),
    options: z.array(choiceOptionSchema).min(2).max(20),
  }),
  z.object({
    type: z.literal("multi_choice"),
    id: z.string().min(1).max(32),
    title: z.string().min(1).max(200),
    subtitle: z.string().max(500).optional(),
    required: z.boolean(),
    options: z.array(choiceOptionSchema).min(2).max(20),
  }),
  z.object({
    type: z.literal("rating"),
    id: z.string().min(1).max(32),
    title: z.string().min(1).max(200),
    subtitle: z.string().max(500).optional(),
    required: z.boolean(),
    scale: z.literal(5),
  }),
  z.object({
    type: z.literal("nps"),
    id: z.string().min(1).max(32),
    title: z.string().min(1).max(200),
    subtitle: z.string().max(500).optional(),
    required: z.boolean(),
  }),
]);
const fullSchema = z.object({
  version: z.literal(1),
  questions: z.array(questionSchema).min(1).max(30),
});

export function registerQuestionnaireTools(
  server: McpServer,
  app: FastifyInstance,
  agentKey: string,
): void {
  server.registerTool("list-questionnaires", {
    description:
      "List structured questionnaire definitions in a project. Questionnaires are multi-question surveys (text, single/multi choice, rating, NPS) shown in-app via the Swift SDK's view modifier — complementary to single-message feedback. Each row carries response_count + last_response_at.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      app_id: z.string().uuid().optional().describe("Filter by app"),
      is_active: z.boolean().optional().describe("Filter by active flag"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().optional().describe("Max results (default 50)"),
    },
  }, async ({ project_id, ...params }) => {
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
