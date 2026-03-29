import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callApi, buildQuery } from "../helpers.js";

export function registerProjectsTools(server: McpServer, app: FastifyInstance, agentKey: string): void {
  server.registerTool("list-projects", {
    description: "List all projects accessible to this agent. Optionally filter by team_id.",
    inputSchema: {
      team_id: z.string().uuid().optional().describe("Filter by team ID"),
    },
  }, async ({ team_id }) => {
    return callApi(app, agentKey, {
      method: "GET",
      url: `/v1/projects${buildQuery({ team_id })}`,
    });
  });

  server.registerTool("get-project", {
    description: "Get a project by ID, including its list of apps.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
    },
  }, async ({ project_id }) => {
    return callApi(app, agentKey, { method: "GET", url: `/v1/projects/${project_id}` });
  });

  server.registerTool("create-project", {
    description:
      "Create a new project. Requires projects:write permission and admin role.",
    inputSchema: {
      team_id: z.string().uuid().describe("The team to create the project in"),
      name: z.string().describe("Project name"),
      slug: z.string().describe("URL-friendly slug (lowercase, hyphens)"),
    },
  }, async ({ team_id, name, slug }) => {
    return callApi(app, agentKey, {
      method: "POST",
      url: "/v1/projects",
      payload: { team_id, name, slug },
    });
  });

  server.registerTool("update-project", {
    description: "Update a project's name. Requires projects:write permission.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project ID"),
      name: z.string().describe("New project name"),
    },
  }, async ({ project_id, name }) => {
    return callApi(app, agentKey, {
      method: "PATCH",
      url: `/v1/projects/${project_id}`,
      payload: { name },
    });
  });
}
