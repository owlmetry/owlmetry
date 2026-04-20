import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { registerAttachmentsTools } from "./tools/attachments.js";

const SKILLS_DIR = resolve(import.meta.dirname, "../../../../skills");

function loadSkillContent(skillName: string): string | null {
  try {
    const raw = readFileSync(resolve(SKILLS_DIR, skillName, "SKILL.md"), "utf-8");
    // Strip YAML frontmatter (--- ... ---)
    return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  } catch {
    return null;
  }
}

const SWIFT_SKILL = loadSkillContent("owlmetry-swift");
const NODE_SKILL = loadSkillContent("owlmetry-node");

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

  // Register SDK skill guides as resources
  if (SWIFT_SKILL) {
    server.registerResource("skill-swift", "owlmetry://skills/swift", {
      description: "Swift SDK integration guide — install, configure, and instrument iOS/macOS apps with OwlMetry (screen tracking, events, metrics, funnels, experiments).",
      mimeType: "text/markdown",
    }, async () => ({
      contents: [{
        uri: "owlmetry://skills/swift",
        mimeType: "text/markdown",
        text: SWIFT_SKILL,
      }],
    }));
  }

  if (NODE_SKILL) {
    server.registerResource("skill-node", "owlmetry://skills/node", {
      description: "Node.js SDK integration guide — install, configure, and instrument backend services with OwlMetry (events, metrics, funnels, experiments, serverless support).",
      mimeType: "text/markdown",
    }, async () => ({
      contents: [{
        uri: "owlmetry://skills/node",
        mimeType: "text/markdown",
        text: NODE_SKILL,
      }],
    }));
  }

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
  registerAttachmentsTools(server, app, agentKey);

  return server;
}
