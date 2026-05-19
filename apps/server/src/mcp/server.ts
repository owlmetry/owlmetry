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
import { registerQuestionnaireTools } from "./tools/questionnaires.js";
import { registerReviewsTools } from "./tools/reviews.js";
import { registerRatingsTools } from "./tools/ratings.js";
import { registerAdsTools } from "./tools/ads.js";
import { registerAttachmentsTools } from "./tools/attachments.js";

// Surfaced to MCP clients during the initialize handshake — Claude Code
// displays this verbatim at the top of every session that has the server
// connected, so it's the primary discovery surface for the feature set.
// Keep it terse and feature-comprehensive; deep concepts live in
// `owlmetry://guide`.
const SERVER_INSTRUCTIONS = `Owlmetry — self-hosted analytics for mobile and backend apps. Use these tools to manage projects/apps, query analytics, and triage user-facing surfaces.

Capabilities:
- Projects & apps — create/update/delete, manage API keys (client/agent/import), team-scoped ownership
- Events & analytics — ingest history, breadcrumb timelines, cross-app session investigation (investigate-event)
- Metrics & funnels — definitions + query rollups (counts, durations, conversion %)
- Issues — clustered error tracking: list, claim, comment, merge, resolve-with-version, silence, snooze, regression detection
- Feedback — free-text user feedback: list, status, comments
- Questionnaires — structured in-app surveys (text / single & multi choice / 1–5 rating / 0–10 NPS) with per-question analytics
- Reviews & ratings — App Store reviews + per-country rating snapshots; reply to reviews
- Ads insights — campaign / ad-group / leaf rankings by revenue + spend + ROAS (Apple Search Ads today)
- Attachments — binary files attached to events; signed downloads
- Integrations — RevenueCat, App Store Connect, Apple Search Ads: add, sync, copy across projects
- Audit logs, background jobs (trigger/cancel), user listings, attribution data

For concepts, resource hierarchy, naming conventions, soft-delete rules, key types, data modes, and end-to-end workflows, fetch the \`owlmetry://guide\` resource — it covers everything tool descriptions don't.`;

export function createMcpServer(app: FastifyInstance, agentKey: string): McpServer {
  const server = new McpServer(
    {
      name: "owlmetry",
      version: "1.0.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  // Register the operational guide as a resource
  server.registerResource("guide", "owlmetry://guide", {
    description: "Owlmetry operational guide — concepts, resource hierarchy, workflows, and conventions for using the MCP tools.",
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
  registerQuestionnaireTools(server, app, agentKey);
  registerReviewsTools(server, app, agentKey);
  registerRatingsTools(server, app, agentKey);
  registerAdsTools(server, app, agentKey);
  registerAttachmentsTools(server, app, agentKey);

  return server;
}
