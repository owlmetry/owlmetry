import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
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
      const body = res.json();
      expect(body.result.serverInfo.name).toBe("owlmetry");
    });

    it("returns 405 for GET /mcp", async () => {
      const res = await app.inject({ method: "GET", url: "/mcp" });
      expect(res.statusCode).toBe(405);
    });

    it("returns 405 for DELETE /mcp", async () => {
      const res = await app.inject({ method: "DELETE", url: "/mcp" });
      expect(res.statusCode).toBe(405);
    });
  });

  describe("tool listing", () => {
    it("returns all registered tools", async () => {
      // Initialize first
      await mcpRequest(TEST_AGENT_KEY, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      });

      const res = await mcpRequest(TEST_AGENT_KEY, "tools/list", {}, 2);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const tools = body.result.tools;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThanOrEqual(37);

      // Verify a few key tools exist
      const names = tools.map((t: { name: string }) => t.name);
      expect(names).toContain("whoami");
      expect(names).toContain("list-projects");
      expect(names).toContain("query-events");
      expect(names).toContain("investigate-event");
      expect(names).toContain("query-metric");
      expect(names).toContain("query-funnel");
      expect(names).toContain("list-audit-logs");
    });
  });

  describe("resource listing", () => {
    it("exposes the guide resource", async () => {
      await mcpRequest(TEST_AGENT_KEY, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      });

      const res = await mcpRequest(TEST_AGENT_KEY, "resources/list", {}, 2);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const resources = body.result.resources;
      expect(resources.length).toBe(1);
      expect(resources[0].uri).toBe("owlmetry://guide");
    });
  });

  describe("tool smoke tests", () => {
    it("whoami returns key info", async () => {
      const res = await callTool(TEST_AGENT_KEY, "whoami");
      const { parsed, isError } = parseToolResult(res);
      expect(isError).toBe(false);
      expect(parsed.type).toBe("api_key");
      expect(parsed.key_type).toBe("agent");
    });

    it("list-projects returns seeded projects", async () => {
      const res = await callTool(TEST_AGENT_KEY, "list-projects");
      const { parsed, isError } = parseToolResult(res);
      expect(isError).toBe(false);
      expect(parsed.projects.length).toBeGreaterThanOrEqual(1);
    });

    it("get-project returns project with apps", async () => {
      const res = await callTool(TEST_AGENT_KEY, "get-project", {
        project_id: testData.projectId,
      });
      const { parsed, isError } = parseToolResult(res);
      expect(isError).toBe(false);
      expect(parsed.id).toBe(testData.projectId);
      expect(Array.isArray(parsed.apps)).toBe(true);
    });

    it("get-app returns seeded app", async () => {
      const res = await callTool(TEST_AGENT_KEY, "get-app", {
        app_id: testData.appId,
      });
      const { parsed, isError } = parseToolResult(res);
      expect(isError).toBe(false);
      expect(parsed.id).toBe(testData.appId);
    });

    it("query-events returns empty result when no events", async () => {
      const res = await callTool(TEST_AGENT_KEY, "query-events", {
        app_id: testData.appId,
      });
      const { parsed, isError } = parseToolResult(res);
      expect(isError).toBe(false);
      expect(parsed.events).toEqual([]);
    });

    it("list-metrics returns empty array", async () => {
      const res = await callTool(TEST_AGENT_KEY, "list-metrics", {
        project_id: testData.projectId,
      });
      const { parsed, isError } = parseToolResult(res);
      expect(isError).toBe(false);
      expect(parsed.metrics).toEqual([]);
    });

    it("list-funnels returns empty array", async () => {
      const res = await callTool(TEST_AGENT_KEY, "list-funnels", {
        project_id: testData.projectId,
      });
      const { parsed, isError } = parseToolResult(res);
      expect(isError).toBe(false);
      expect(parsed.funnels).toEqual([]);
    });
  });

  describe("permission enforcement", () => {
    it("returns error when agent key lacks required permission", async () => {
      // TEST_AGENT_KEY has: events:read, funnels:read, apps:read, projects:read, metrics:read
      // create-project requires projects:write — should fail
      const res = await callTool(TEST_AGENT_KEY, "create-project", {
        team_id: testData.teamId,
        name: "Blocked Project",
        slug: "blocked-project",
      });
      const { parsed, isError } = parseToolResult(res);
      expect(isError).toBe(true);
      expect(parsed.error).toMatch(/permission/i);
    });
  });

  describe("write operations", () => {
    it("create-project and list-projects round-trip", async () => {
      const { token, teamId } = await getTokenAndTeamId(app);
      const fullKey = await createAgentKey(app, token, teamId, [
        "projects:read",
        "projects:write",
        "apps:read",
        "apps:write",
        "events:read",
        "funnels:read",
        "funnels:write",
        "metrics:read",
        "metrics:write",
        "audit_logs:read",
        "jobs:read",
        "jobs:write",
        "integrations:read",
        "integrations:write",
        "users:write",
      ]);

      // Create a project
      const createRes = await callTool(fullKey, "create-project", {
        team_id: teamId,
        name: "MCP Test Project",
        slug: "mcp-test-project",
      });
      const { parsed: created, isError: createErr } = parseToolResult(createRes);
      expect(createErr).toBe(false);
      expect(created.name).toBe("MCP Test Project");

      // List projects and verify it appears
      const listRes = await callTool(fullKey, "list-projects");
      const { parsed: listed } = parseToolResult(listRes);
      const found = listed.projects.find((p: { slug: string }) => p.slug === "mcp-test-project");
      expect(found).toBeTruthy();
    });
  });

  describe("error handling", () => {
    it("returns isError for non-existent resource", async () => {
      const res = await callTool(TEST_AGENT_KEY, "get-project", {
        project_id: "00000000-0000-0000-0000-000000000000",
      });
      const { isError } = parseToolResult(res);
      expect(isError).toBe(true);
    });
  });

  describe("investigate-event", () => {
    it("returns target and context events", async () => {
      // Ingest some events first
      const now = new Date();
      const events = [
        { level: "info", message: "before event", session_id: TEST_SESSION_ID, timestamp: new Date(now.getTime() - 60000).toISOString() },
        { level: "error", message: "target event", session_id: TEST_SESSION_ID, timestamp: now.toISOString() },
        { level: "info", message: "after event", session_id: TEST_SESSION_ID, timestamp: new Date(now.getTime() + 60000).toISOString() },
      ];

      const ingestRes = await app.inject({
        method: "POST",
        url: "/v1/ingest",
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: { bundle_id: TEST_BUNDLE_ID, events },
      });
      expect(ingestRes.statusCode).toBe(200);

      // Query to find the target event
      const queryRes = await callTool(TEST_AGENT_KEY, "query-events", {
        app_id: testData.appId,
        data_mode: "all",
      });
      const { parsed: queried } = parseToolResult(queryRes);
      const targetEvent = queried.events.find((e: { message: string }) => e.message === "target event");
      expect(targetEvent).toBeTruthy();

      // Investigate
      const investigateRes = await callTool(TEST_AGENT_KEY, "investigate-event", {
        event_id: targetEvent.id,
        window_minutes: 5,
      });
      const { parsed, isError } = parseToolResult(investigateRes);
      expect(isError).toBe(false);
      expect(parsed.target).toBeTruthy();
      expect(parsed.target.message).toBe("target event");
      expect(parsed.context.length).toBeGreaterThanOrEqual(2); // at least before and after
    });
  });
});
