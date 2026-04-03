import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEFAULT_API_KEY_PERMISSIONS } from "@owlmetry/shared";
import {
  buildApp,
  setupTestDb,
  truncateAll,
  seedTestData,
  TEST_AGENT_KEY,
  TEST_CLIENT_KEY,
  getTokenAndTeamId,
  createAgentKey,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
} from "./setup.js";

let app: FastifyInstance;
let testData: Awaited<ReturnType<typeof seedTestData>>;

const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

/** Send an MCP JSON-RPC request to /mcp */
async function mcpRequest(
  agentKey: string,
  method: string,
  params: Record<string, unknown> = {},
  id: number = 1,
) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      ...MCP_HEADERS,
      authorization: `Bearer ${agentKey}`,
    },
    payload: {
      jsonrpc: "2.0",
      id,
      method,
      params,
    },
  });
}

/** Call an MCP tool directly (stateless mode — no initialize needed) */
async function callTool(
  agentKey: string,
  toolName: string,
  args: Record<string, unknown> = {},
) {
  return mcpRequest(agentKey, "tools/call", {
    name: toolName,
    arguments: args,
  });
}

/** Parse MCP tool result text content */
function parseToolResult(res: Awaited<ReturnType<typeof app.inject>>) {
  const body = res.json();
  if (!body.result?.content?.[0]?.text) return body;
  return {
    ...body,
    parsed: JSON.parse(body.result.content[0].text),
    isError: body.result.isError ?? false,
  };
}

/** Create a full-permissions agent key for write tests */
async function createFullAgentKey() {
  const { token, teamId } = await getTokenAndTeamId(app);
  const key = await createAgentKey(app, token, teamId, [...DEFAULT_API_KEY_PERMISSIONS.agent]);
  return { key, teamId };
}

/** Ingest test events and return the ingested count */
async function ingestEvents(events: Record<string, unknown>[]) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: { bundle_id: TEST_BUNDLE_ID, events },
  });
  expect(res.statusCode).toBe(200);
}

beforeAll(async () => {
  await setupTestDb();
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  testData = await seedTestData();
});

describe("MCP endpoint", () => {
  // ── Auth ──────────────────────────────────────────────────────────────

  describe("auth enforcement", () => {
    it("returns 401 without authorization header", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: MCP_HEADERS,
        payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/agent API key/);
    });

    it("returns 401 for client key", async () => {
      const res = await mcpRequest(TEST_CLIENT_KEY, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("accepts agent key and returns valid initialize response", async () => {
      const res = await mcpRequest(TEST_AGENT_KEY, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().result.serverInfo.name).toBe("owlmetry");
    });

    it("returns 405 for GET /mcp without auth (avoids OAuth trigger)", async () => {
      const res = await app.inject({ method: "GET", url: "/mcp" });
      expect(res.statusCode).toBe(405);
    });

    it("returns 405 for DELETE /mcp", async () => {
      const res = await app.inject({ method: "DELETE", url: "/mcp" });
      expect(res.statusCode).toBe(405);
    });
  });

  // ── Tool & Resource listing ───────────────────────────────────────────

  describe("tool listing", () => {
    it("returns all registered tools with schemas", async () => {
      const res = await callTool(TEST_AGENT_KEY, "whoami"); // any tool call works
      // Use tools/list to check
      const listRes = await mcpRequest(TEST_AGENT_KEY, "tools/list");
      const tools = listRes.json().result.tools;
      expect(tools.length).toBeGreaterThanOrEqual(37);

      const names = tools.map((t: { name: string }) => t.name);
      expect(names).toContain("whoami");
      expect(names).toContain("list-projects");
      expect(names).toContain("query-events");
      expect(names).toContain("investigate-event");
      expect(names).toContain("query-metric");
      expect(names).toContain("query-funnel");
      expect(names).toContain("list-audit-logs");

      // Each tool has description and inputSchema
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeTruthy();
      }
    });
  });

  describe("resource listing", () => {
    it("exposes guide and SDK skill resources", async () => {
      const listRes = await mcpRequest(TEST_AGENT_KEY, "resources/list");
      const resources = listRes.json().result.resources;
      const uris = resources.map((r: { uri: string }) => r.uri).sort();
      expect(uris).toContain("owlmetry://guide");
      expect(uris).toContain("owlmetry://skills/swift");
      expect(uris).toContain("owlmetry://skills/node");

      // Read the guide resource
      const readRes = await mcpRequest(TEST_AGENT_KEY, "resources/read", {
        uri: "owlmetry://guide",
      });
      const contents = readRes.json().result.contents;
      expect(contents[0].mimeType).toBe("text/markdown");
      expect(contents[0].text).toContain("OwlMetry");
      expect(contents[0].text).toContain("Resource Hierarchy");
      expect(contents[0].text).toContain("SDK Integration Guides");
    });

    it("serves Swift SDK skill content", async () => {
      const res = await mcpRequest(TEST_AGENT_KEY, "resources/read", {
        uri: "owlmetry://skills/swift",
      });
      const contents = res.json().result.contents;
      expect(contents[0].mimeType).toBe("text/markdown");
      expect(contents[0].text).toContain("Swift SDK");
      expect(contents[0].text).toContain("Owl.configure");
      // Frontmatter should be stripped
      expect(contents[0].text).not.toMatch(/^---/);
    });

    it("serves Node.js SDK skill content", async () => {
      const res = await mcpRequest(TEST_AGENT_KEY, "resources/read", {
        uri: "owlmetry://skills/node",
      });
      const contents = res.json().result.contents;
      expect(contents[0].mimeType).toBe("text/markdown");
      expect(contents[0].text).toContain("Node.js SDK");
      expect(contents[0].text).toContain("Owl.configure");
      // Frontmatter should be stripped
      expect(contents[0].text).not.toMatch(/^---/);
    });
  });

  // ── Permission enforcement ────────────────────────────────────────────

  describe("permission enforcement", () => {
    it("rejects create-project without projects:write", async () => {
      const { parsed, isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "create-project", {
          team_id: testData.teamId,
          name: "Blocked",
          slug: "blocked",
        }),
      );
      expect(isError).toBe(true);
      expect(parsed.error).toMatch(/permission/i);
    });

    it("rejects create-app without apps:write", async () => {
      const { isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "create-app", {
          name: "Blocked App",
          platform: "apple",
          project_id: testData.projectId,
          bundle_id: "com.test.blocked",
        }),
      );
      expect(isError).toBe(true);
    });

    it("rejects create-metric without metrics:write", async () => {
      const { isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "create-metric", {
          project_id: testData.projectId,
          name: "Blocked",
          slug: "blocked",
        }),
      );
      expect(isError).toBe(true);
    });

    it("rejects create-funnel without funnels:write", async () => {
      const { isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "create-funnel", {
          project_id: testData.projectId,
          name: "Blocked",
          slug: "blocked",
          steps: [{ name: "step1", event_filter: { step_name: "s1" } }],
        }),
      );
      expect(isError).toBe(true);
    });

    it("allows read operations with read-only key", async () => {
      const { isError: e1 } = parseToolResult(await callTool(TEST_AGENT_KEY, "list-projects"));
      const { isError: e2 } = parseToolResult(await callTool(TEST_AGENT_KEY, "list-apps"));
      const { isError: e3 } = parseToolResult(await callTool(TEST_AGENT_KEY, "query-events"));
      expect(e1).toBe(false);
      expect(e2).toBe(false);
      expect(e3).toBe(false);
    });
  });

  // ── Projects CRUD ─────────────────────────────────────────────────────

  describe("projects", () => {
    it("create → get → update → list lifecycle", async () => {
      const { key, teamId } = await createFullAgentKey();

      // Create
      const { parsed: created } = parseToolResult(
        await callTool(key, "create-project", {
          team_id: teamId,
          name: "MCP Project",
          slug: "mcp-project",
        }),
      );
      expect(created.name).toBe("MCP Project");
      expect(created.slug).toBe("mcp-project");
      expect(created.id).toBeTruthy();

      // Get with apps
      const { parsed: fetched } = parseToolResult(
        await callTool(key, "get-project", { project_id: created.id }),
      );
      expect(fetched.id).toBe(created.id);
      expect(Array.isArray(fetched.apps)).toBe(true);

      // Update
      const { parsed: updated } = parseToolResult(
        await callTool(key, "update-project", {
          project_id: created.id,
          name: "Updated MCP Project",
        }),
      );
      expect(updated.name).toBe("Updated MCP Project");

      // List — verify both seeded and new project
      const { parsed: listed } = parseToolResult(await callTool(key, "list-projects"));
      const slugs = listed.projects.map((p: { slug: string }) => p.slug);
      expect(slugs).toContain("mcp-project");
      expect(slugs).toContain("test-project");
    });

    it("list-projects filters by team_id", async () => {
      const { parsed } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "list-projects", { team_id: testData.teamId }),
      );
      expect(parsed.projects.length).toBeGreaterThanOrEqual(1);
      for (const p of parsed.projects) {
        expect(p.team_id).toBe(testData.teamId);
      }
    });
  });

  // ── Apps CRUD ─────────────────────────────────────────────────────────

  describe("apps", () => {
    it("create → get → update lifecycle", async () => {
      const { key } = await createFullAgentKey();

      // Create apple app with bundle_id
      const { parsed: created } = parseToolResult(
        await callTool(key, "create-app", {
          name: "MCP iOS App",
          platform: "apple",
          project_id: testData.projectId,
          bundle_id: "com.owlmetry.mcp.test",
        }),
      );
      expect(created.name).toBe("MCP iOS App");
      expect(created.platform).toBe("apple");
      expect(created.client_secret).toBeTruthy();
      expect(created.client_secret).toMatch(/^owl_client_/);

      // Get
      const { parsed: fetched } = parseToolResult(
        await callTool(key, "get-app", { app_id: created.id }),
      );
      expect(fetched.id).toBe(created.id);
      expect(fetched.bundle_id).toBe("com.owlmetry.mcp.test");

      // Update
      const { parsed: updated } = parseToolResult(
        await callTool(key, "update-app", { app_id: created.id, name: "Renamed App" }),
      );
      expect(updated.name).toBe("Renamed App");
    });

    it("creates backend app without bundle_id", async () => {
      const { key } = await createFullAgentKey();
      const { parsed, isError } = parseToolResult(
        await callTool(key, "create-app", {
          name: "Backend Service",
          platform: "backend",
          project_id: testData.projectId,
        }),
      );
      expect(isError).toBe(false);
      expect(parsed.platform).toBe("backend");
      expect(parsed.bundle_id).toBeNull();
    });

    it("list-apps returns seeded apps", async () => {
      const { parsed } = parseToolResult(await callTool(TEST_AGENT_KEY, "list-apps"));
      expect(parsed.apps.length).toBeGreaterThanOrEqual(3); // ios, backend, android from seed
    });
  });

  // ── Events ────────────────────────────────────────────────────────────

  describe("events", () => {
    it("query-events with filters", async () => {
      const now = new Date();
      await ingestEvents([
        { level: "info", message: "info msg", session_id: TEST_SESSION_ID, timestamp: now.toISOString() },
        { level: "error", message: "error msg", session_id: TEST_SESSION_ID, timestamp: now.toISOString() },
      ]);

      // Filter by level
      const { parsed } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "query-events", {
          app_id: testData.appId,
          level: "error",
          data_mode: "all",
        }),
      );
      expect(parsed.events.length).toBe(1);
      expect(parsed.events[0].message).toBe("error msg");
    });

    it("query-events with time range", async () => {
      const now = new Date();
      await ingestEvents([
        { level: "info", message: "recent", session_id: TEST_SESSION_ID, timestamp: now.toISOString() },
      ]);

      const { parsed } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "query-events", {
          app_id: testData.appId,
          since: "1h",
          data_mode: "all",
        }),
      );
      expect(parsed.events.length).toBe(1);
    });

    it("query-events respects limit", async () => {
      const now = new Date();
      const events = Array.from({ length: 5 }, (_, i) => ({
        level: "info",
        message: `event ${i}`,
        session_id: TEST_SESSION_ID,
        timestamp: new Date(now.getTime() - i * 1000).toISOString(),
      }));
      await ingestEvents(events);

      const { parsed } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "query-events", {
          app_id: testData.appId,
          limit: 2,
          data_mode: "all",
        }),
      );
      expect(parsed.events.length).toBe(2);
      expect(parsed.has_more).toBe(true);
      expect(parsed.cursor).toBeTruthy();
    });

    it("query-events pagination with cursor", async () => {
      const now = new Date();
      const events = Array.from({ length: 3 }, (_, i) => ({
        level: "info",
        message: `page-event-${i}`,
        session_id: TEST_SESSION_ID,
        timestamp: new Date(now.getTime() - i * 1000).toISOString(),
      }));
      await ingestEvents(events);

      // First page
      const { parsed: page1 } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "query-events", {
          app_id: testData.appId,
          limit: 2,
          data_mode: "all",
        }),
      );
      expect(page1.events.length).toBe(2);

      // Second page with cursor
      const { parsed: page2 } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "query-events", {
          app_id: testData.appId,
          limit: 2,
          cursor: page1.cursor,
          data_mode: "all",
        }),
      );
      expect(page2.events.length).toBe(1);
    });

    it("get-event returns full details", async () => {
      const now = new Date();
      await ingestEvents([
        { level: "warn", message: "detail test", session_id: TEST_SESSION_ID, timestamp: now.toISOString(), screen_name: "HomeScreen" },
      ]);

      const { parsed: queried } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "query-events", { app_id: testData.appId, data_mode: "all" }),
      );
      const eventId = queried.events[0].id;

      const { parsed, isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "get-event", { event_id: eventId }),
      );
      expect(isError).toBe(false);
      expect(parsed.message).toBe("detail test");
      expect(parsed.level).toBe("warn");
      expect(parsed.screen_name).toBe("HomeScreen");
    });

    it("investigate-event returns target and context", async () => {
      const now = new Date();
      await ingestEvents([
        { level: "info", message: "before", session_id: TEST_SESSION_ID, timestamp: new Date(now.getTime() - 60000).toISOString() },
        { level: "error", message: "target", session_id: TEST_SESSION_ID, timestamp: now.toISOString() },
        { level: "info", message: "after", session_id: TEST_SESSION_ID, timestamp: new Date(now.getTime() + 60000).toISOString() },
      ]);

      const { parsed: queried } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "query-events", { app_id: testData.appId, data_mode: "all" }),
      );
      const target = queried.events.find((e: { message: string }) => e.message === "target");

      const { parsed, isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "investigate-event", { event_id: target.id, window_minutes: 5 }),
      );
      expect(isError).toBe(false);
      expect(parsed.target.message).toBe("target");
      expect(parsed.context.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Metrics CRUD + query ──────────────────────────────────────────────

  describe("metrics", () => {
    it("create → get → update → query → delete lifecycle", async () => {
      const { key } = await createFullAgentKey();

      // Create
      const { parsed: created, isError: createErr } = parseToolResult(
        await callTool(key, "create-metric", {
          project_id: testData.projectId,
          name: "Page Load Time",
          slug: "page-load-time",
          description: "Time to interactive",
        }),
      );
      expect(createErr).toBe(false);
      expect(created.name).toBe("Page Load Time");
      expect(created.slug).toBe("page-load-time");

      // Get
      const { parsed: fetched } = parseToolResult(
        await callTool(key, "get-metric", {
          project_id: testData.projectId,
          slug: "page-load-time",
        }),
      );
      expect(fetched.slug).toBe("page-load-time");
      expect(fetched.description).toBe("Time to interactive");

      // Update
      const { parsed: updated } = parseToolResult(
        await callTool(key, "update-metric", {
          project_id: testData.projectId,
          slug: "page-load-time",
          description: "Updated description",
        }),
      );
      expect(updated.description).toBe("Updated description");

      // List
      const { parsed: listed } = parseToolResult(
        await callTool(key, "list-metrics", { project_id: testData.projectId }),
      );
      expect(listed.metrics.length).toBe(1);
      expect(listed.metrics[0].slug).toBe("page-load-time");

      // Query (no events yet — returns zero counts)
      const { parsed: queried } = parseToolResult(
        await callTool(key, "query-metric", {
          project_id: testData.projectId,
          slug: "page-load-time",
        }),
      );
      expect(queried.aggregation.total_count).toBe(0);

      // Delete
      const { parsed: deleted, isError: delErr } = parseToolResult(
        await callTool(key, "delete-metric", {
          project_id: testData.projectId,
          slug: "page-load-time",
        }),
      );
      expect(delErr).toBe(false);
      expect(deleted.deleted).toBe(true);

      // Verify deleted
      const { parsed: afterDelete } = parseToolResult(
        await callTool(key, "list-metrics", { project_id: testData.projectId }),
      );
      expect(afterDelete.metrics.length).toBe(0);
    });

    it("query-metric with metric events", async () => {
      const { key } = await createFullAgentKey();

      // Create metric definition
      await callTool(key, "create-metric", {
        project_id: testData.projectId,
        name: "API Call",
        slug: "api-call",
      });

      // Ingest metric events
      const now = new Date();
      await ingestEvents([
        { level: "info", message: "metric:api-call:start", session_id: TEST_SESSION_ID, timestamp: now.toISOString() },
        { level: "info", message: "metric:api-call:complete", session_id: TEST_SESSION_ID, timestamp: new Date(now.getTime() + 500).toISOString(), custom_attributes: { duration_ms: 500 } },
      ]);

      // Query aggregation
      const { parsed } = parseToolResult(
        await callTool(key, "query-metric", {
          project_id: testData.projectId,
          slug: "api-call",
          data_mode: "all",
        }),
      );
      expect(parsed.aggregation.total_count).toBeGreaterThanOrEqual(1);

      // List raw metric events
      const { parsed: rawEvents } = parseToolResult(
        await callTool(key, "list-metric-events", {
          project_id: testData.projectId,
          slug: "api-call",
          data_mode: "all",
        }),
      );
      expect(rawEvents.events.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Funnels CRUD + query ──────────────────────────────────────────────

  describe("funnels", () => {
    it("create → get → update → query → delete lifecycle", async () => {
      const { key } = await createFullAgentKey();

      // Create
      const { parsed: created, isError: createErr } = parseToolResult(
        await callTool(key, "create-funnel", {
          project_id: testData.projectId,
          name: "Onboarding",
          slug: "onboarding",
          description: "New user onboarding",
          steps: [
            { name: "Sign Up", event_filter: { step_name: "sign-up" } },
            { name: "Profile", event_filter: { step_name: "profile" } },
            { name: "First Action", event_filter: { step_name: "first-action" } },
          ],
        }),
      );
      expect(createErr).toBe(false);
      expect(created.name).toBe("Onboarding");
      expect(created.steps.length).toBe(3);

      // Get
      const { parsed: fetched } = parseToolResult(
        await callTool(key, "get-funnel", {
          project_id: testData.projectId,
          slug: "onboarding",
        }),
      );
      expect(fetched.steps[0].name).toBe("Sign Up");
      expect(fetched.steps[0].event_filter.step_name).toBe("sign-up");

      // Update steps
      const { parsed: updated } = parseToolResult(
        await callTool(key, "update-funnel", {
          project_id: testData.projectId,
          slug: "onboarding",
          steps: [
            { name: "Sign Up", event_filter: { step_name: "sign-up" } },
            { name: "Tutorial", event_filter: { step_name: "tutorial" } },
          ],
        }),
      );
      expect(updated.steps.length).toBe(2);

      // List
      const { parsed: listed } = parseToolResult(
        await callTool(key, "list-funnels", { project_id: testData.projectId }),
      );
      expect(listed.funnels.length).toBe(1);

      // Query (no events — empty analytics)
      const { parsed: queried, isError: queryErr } = parseToolResult(
        await callTool(key, "query-funnel", {
          project_id: testData.projectId,
          slug: "onboarding",
        }),
      );
      expect(queryErr).toBe(false);
      expect(queried.analytics).toBeTruthy();

      // Delete
      const { parsed: deleted } = parseToolResult(
        await callTool(key, "delete-funnel", {
          project_id: testData.projectId,
          slug: "onboarding",
        }),
      );
      expect(deleted.deleted).toBe(true);

      // Verify deleted
      const { parsed: afterDelete } = parseToolResult(
        await callTool(key, "list-funnels", { project_id: testData.projectId }),
      );
      expect(afterDelete.funnels.length).toBe(0);
    });

    it("query-funnel supports open and closed modes", async () => {
      const { key } = await createFullAgentKey();

      await callTool(key, "create-funnel", {
        project_id: testData.projectId,
        name: "Mode Test",
        slug: "mode-test",
        steps: [
          { name: "Step 1", event_filter: { step_name: "step-1" } },
          { name: "Step 2", event_filter: { step_name: "step-2" } },
        ],
      });

      // Open mode (default)
      const { parsed: open, isError: openErr } = parseToolResult(
        await callTool(key, "query-funnel", {
          project_id: testData.projectId,
          slug: "mode-test",
          mode: "open",
        }),
      );
      expect(openErr).toBe(false);
      expect(open.analytics.mode).toBe("open");

      // Closed mode
      const { parsed: closed, isError: closedErr } = parseToolResult(
        await callTool(key, "query-funnel", {
          project_id: testData.projectId,
          slug: "mode-test",
          mode: "closed",
        }),
      );
      expect(closedErr).toBe(false);
      expect(closed.analytics.mode).toBe("closed");
    });
  });

  // ── Integrations ──────────────────────────────────────────────────────

  describe("integrations", () => {
    it("list-providers returns available providers", async () => {
      const { key } = await createFullAgentKey();
      const { parsed, isError } = parseToolResult(
        await callTool(key, "list-providers", { project_id: testData.projectId }),
      );
      expect(isError).toBe(false);
      expect(parsed.providers.length).toBeGreaterThanOrEqual(1);
      const names = parsed.providers.map((p: { id: string }) => p.id);
      expect(names).toContain("revenuecat");
    });

    it("add → list → update → remove integration lifecycle", async () => {
      const { key } = await createFullAgentKey();

      // Add
      const addRes = await callTool(key, "add-integration", {
        project_id: testData.projectId,
        provider: "revenuecat",
        config: { api_key: "rc_test_key_123" },
      });
      const { parsed: added, isError: addErr } = parseToolResult(addRes);
      expect(addErr).toBe(false);
      expect(added.provider).toBe("revenuecat");
      expect(added.webhook_setup).toBeDefined();
      expect(added.webhook_setup.webhook_url).toContain("/v1/webhooks/revenuecat/");
      expect(added.webhook_setup.authorization_header).toMatch(/^Bearer whsec_/);

      // Verify second content block has formatted webhook setup text
      const addBody = addRes.json();
      expect(addBody.result.content).toHaveLength(2);
      expect(addBody.result.content[1].text).toContain("RevenueCat Webhook Setup");

      // List
      const { parsed: listed } = parseToolResult(
        await callTool(key, "list-integrations", { project_id: testData.projectId }),
      );
      expect(listed.integrations.length).toBe(1);

      // Update (disable)
      const { parsed: updated } = parseToolResult(
        await callTool(key, "update-integration", {
          project_id: testData.projectId,
          provider: "revenuecat",
          enabled: false,
        }),
      );
      expect(updated.enabled).toBe(false);

      // Remove
      const { parsed: removed } = parseToolResult(
        await callTool(key, "remove-integration", {
          project_id: testData.projectId,
          provider: "revenuecat",
        }),
      );
      expect(removed.deleted).toBe(true);
    });
  });

  // ── Jobs ──────────────────────────────────────────────────────────────

  describe("jobs", () => {
    it("list-jobs returns results", async () => {
      const { key, teamId } = await createFullAgentKey();
      const { parsed, isError } = parseToolResult(
        await callTool(key, "list-jobs", { team_id: teamId }),
      );
      expect(isError).toBe(false);
      expect(Array.isArray(parsed.job_runs)).toBe(true);
    });

    it("trigger-job and get-job round-trip", async () => {
      const { key, teamId } = await createFullAgentKey();

      // Set up revenuecat integration (required for revenuecat_sync)
      await callTool(key, "add-integration", {
        project_id: testData.projectId,
        provider: "revenuecat",
        config: { api_key: "rc_test_key" },
      });

      const { parsed: triggered, isError: triggerErr } = parseToolResult(
        await callTool(key, "trigger-job", {
          team_id: teamId,
          job_type: "revenuecat_sync",
          project_id: testData.projectId,
        }),
      );
      expect(triggerErr).toBe(false);
      expect(triggered.job_run).toBeTruthy();
      expect(triggered.job_run.id).toBeTruthy();

      // Get job details
      const { parsed: details, isError: getErr } = parseToolResult(
        await callTool(key, "get-job", { run_id: triggered.job_run.id }),
      );
      expect(getErr).toBe(false);
      expect(details.job_run.job_type).toBe("revenuecat_sync");
    });
  });

  // ── Audit Logs ────────────────────────────────────────────────────────

  describe("audit-logs", () => {
    it("list-audit-logs returns entries after mutations", async () => {
      const { key, teamId } = await createFullAgentKey();

      // Create a project to generate an audit log entry
      await callTool(key, "create-project", {
        team_id: teamId,
        name: "Audit Test",
        slug: "audit-test",
      });

      const { parsed, isError } = parseToolResult(
        await callTool(key, "list-audit-logs", { team_id: teamId }),
      );
      expect(isError).toBe(false);
      expect(parsed.audit_logs.length).toBeGreaterThanOrEqual(1);
    });

    it("list-audit-logs filters by action", async () => {
      const { key, teamId } = await createFullAgentKey();

      // Create then update a project
      const { parsed: created } = parseToolResult(
        await callTool(key, "create-project", {
          team_id: teamId,
          name: "Filter Test",
          slug: "filter-test",
        }),
      );
      await callTool(key, "update-project", {
        project_id: created.id,
        name: "Filter Test Updated",
      });

      // Filter for create actions only
      const { parsed } = parseToolResult(
        await callTool(key, "list-audit-logs", {
          team_id: teamId,
          action: "create",
        }),
      );
      for (const log of parsed.audit_logs) {
        expect(log.action).toBe("create");
      }
    });
  });

  // ── App Users ─────────────────────────────────────────────────────────

  describe("app users", () => {
    it("list-app-users returns users after events with user_id", async () => {
      const now = new Date();
      await ingestEvents([
        { level: "info", message: "user event", session_id: TEST_SESSION_ID, timestamp: now.toISOString(), user_id: "user-123" },
      ]);

      const { parsed, isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "list-app-users", { app_id: testData.appId }),
      );
      expect(isError).toBe(false);
      expect(Array.isArray(parsed.users)).toBe(true);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns isError for non-existent project", async () => {
      const { isError, parsed } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "get-project", {
          project_id: "00000000-0000-0000-0000-000000000000",
        }),
      );
      expect(isError).toBe(true);
      expect(parsed.error).toBeTruthy();
    });

    it("returns isError for non-existent app", async () => {
      const { isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "get-app", {
          app_id: "00000000-0000-0000-0000-000000000000",
        }),
      );
      expect(isError).toBe(true);
    });

    it("returns isError for non-existent event", async () => {
      const { isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "get-event", {
          event_id: "00000000-0000-0000-0000-000000000000",
        }),
      );
      expect(isError).toBe(true);
    });

    it("returns isError for non-existent metric slug", async () => {
      const { isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "get-metric", {
          project_id: testData.projectId,
          slug: "nonexistent",
        }),
      );
      expect(isError).toBe(true);
    });

    it("returns isError for non-existent funnel slug", async () => {
      const { isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "get-funnel", {
          project_id: testData.projectId,
          slug: "nonexistent",
        }),
      );
      expect(isError).toBe(true);
    });

    it("returns isError for non-existent job run", async () => {
      const { isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "get-job", {
          run_id: "00000000-0000-0000-0000-000000000000",
        }),
      );
      expect(isError).toBe(true);
    });
  });

  // ── Whoami ────────────────────────────────────────────────────────────

  describe("whoami", () => {
    it("returns agent key details", async () => {
      const { parsed, isError } = parseToolResult(
        await callTool(TEST_AGENT_KEY, "whoami"),
      );
      expect(isError).toBe(false);
      expect(parsed.type).toBe("api_key");
      expect(parsed.key_type).toBe("agent");
      expect(parsed.team).toBeTruthy();
      expect(Array.isArray(parsed.permissions)).toBe(true);
    });
  });
});
