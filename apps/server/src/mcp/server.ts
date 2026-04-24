import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { GUIDE_CONTENT } from "./guide.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerProjectsTools } from "./tools/projects.js";
import { registerAppsTools } from "./tools/apps.js";
import { registerEventsTools } from "./tools/events.js";
import { registerMetricsTools } from "./tools/metrics.js";
import { registerFunnelsTools } from "./tools/funnels.js";
import { registerIntegrationsTools } from "./tools/integrations.js";
import { registerJobsTools } from "./tools/jobs.js";
import { registerAuditLogsTools } from "./tools/audit-logs.js";
import { registerIssuesTools } from "./tools/issues.js";
import { registerFeedbackTools } from "./tools/feedback.js";
import { registerAttachmentsTools } from "./tools/attachments.js";

export function createMcpServer(app: FastifyInstance, agentKey: string): McpServer {
  const server = new McpServer({
    name: "owlmetry",
    version: "1.0.0",
  });

  // Register the operational guide as a resource
  server.registerResource("guide", "owlmetry://guide", {
    description: "OwlMetry operational guide — concepts, resource hierarchy, workflows, and conventions for using the MCP tools.",
    mimeType: "text/markdown",
  }, async () => ({
    contents: [{
      uri: "owlmetry://guide",
      mimeType: "text/markdown",
      text: GUIDE_CONTENT,
    }],
  }));

  // Register all tool domains
  registerAuthTools(server, app, agentKey);
  registerProjectsTools(server, app, agentKey);
  registerAppsTools(server, app, agentKey);
  registerEventsTools(server, app, agentKey);
  registerMetricsTools(server, app, agentKey);
  registerFunnelsTools(server, app, agentKey);
  registerIntegrationsTools(server, app, agentKey);
  registerJobsTools(server, app, agentKey);
  registerAuditLogsTools(server, app, agentKey);
  registerIssuesTools(server, app, agentKey);
  registerFeedbackTools(server, app, agentKey);
  registerAttachmentsTools(server, app, agentKey);

  return server;
}
