import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  createUserAndGetToken,
  createAgentKey,
  addTeamMember,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
} from "./setup.js";

let app: FastifyInstance;
let testData: Awaited<ReturnType<typeof seedTestData>>;
let token: string;
let teamId: string;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  testData = await seedTestData();
  ({ token, teamId } = await getTokenAndTeamId(app));
});

afterAll(async () => {
  await app.close();
});

/** Helper: small delay so fire-and-forget audit writes settle */
const waitForAuditWrites = () => new Promise((r) => setTimeout(r, 100));

/** Helper: create a project via API (generates audit log entry) */
async function createProject(name: string, slug: string) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: { authorization: `Bearer ${token}` },
    payload: { name, slug, team_id: teamId },
  });
  return res.json();
}

/** Helper: fetch audit logs */
async function getAuditLogs(
  authHeader: Record<string, string>,
  query: Record<string, string> = {},
) {
  const params = new URLSearchParams(query).toString();
  const url = `/v1/teams/${teamId}/audit-logs${params ? `?${params}` : ""}`;
  return app.inject({ method: "GET", url, headers: authHeader });
}

// ─── 1. Auth & Permissions ───────────────────────────────────────────────────

describe("Auth & Permissions", () => {
  it("401 for unauthenticated request", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/audit-logs`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for member-role user", async () => {
    const { token: memberToken, userId: memberUserId } =
      await createUserAndGetToken(app, "member@owlmetry.com");
    await addTeamMember(teamId, memberUserId, "member");

    const res = await getAuditLogs({
      authorization: `Bearer ${memberToken}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 for admin-role user", async () => {
    const { token: adminToken, userId: adminUserId } =
      await createUserAndGetToken(app, "admin@owlmetry.com");
    await addTeamMember(teamId, adminUserId, "admin");

    const res = await getAuditLogs({ authorization: `Bearer ${adminToken}` });
    expect(res.statusCode).toBe(200);
  });

  it("200 for owner-role user", async () => {
    const res = await getAuditLogs({ authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
  });

  it("403 for agent key without audit_logs:read", async () => {
    const res = await getAuditLogs({
      authorization: `Bearer ${TEST_AGENT_KEY}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 for agent key with audit_logs:read", async () => {
    const key = await createAgentKey(app, token, teamId, [
      "audit_logs:read",
    ]);
    const res = await getAuditLogs({ authorization: `Bearer ${key}` });
    expect(res.statusCode).toBe(200);
  });

  it("403 for client key", async () => {
    const res = await getAuditLogs({
      authorization: `Bearer ${TEST_CLIENT_KEY}`,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── 2. Basic Listing ────────────────────────────────────────────────────────

describe("Basic Listing", () => {
  it("returns empty array when no audit logs exist", async () => {
    const res = await getAuditLogs({ authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.audit_logs).toEqual([]);
    expect(body.has_more).toBe(false);
    expect(body.cursor).toBeNull();
  });

  it("returns entry after creating a project with all expected fields", async () => {
    const project = await createProject("Audit Test", "audit-test");
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_type: "project", resource_id: project.id },
    );
    const body = res.json();

    expect(body.audit_logs).toHaveLength(1);
    const entry = body.audit_logs[0];
    expect(entry.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(entry.team_id).toBe(teamId);
    expect(entry.actor_type).toBe("user");
    expect(entry.actor_id).toBeDefined();
    expect(entry.action).toBe("create");
    expect(entry.resource_type).toBe("project");
    expect(entry.resource_id).toBe(project.id);
    expect(entry.metadata).toEqual({ name: "Audit Test", slug: "audit-test" });
    expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
  });

  it("returns entries in reverse chronological order", async () => {
    await createProject("First", "first");
    await createProject("Second", "second");
    await createProject("Third", "third");
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_type: "project", action: "create" },
    );
    const entries = res.json().audit_logs;

    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < entries.length - 1; i++) {
      expect(new Date(entries[i].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(entries[i + 1].timestamp).getTime(),
      );
    }
  });
});

// ─── 3. Filtering ────────────────────────────────────────────────────────────

describe("Filtering", () => {
  it("resource_type filters correctly", async () => {
    const project = await createProject("Filter Test", "filter-test");

    // Also create an app (generates an "app" resource_type entry)
    await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Filter App",
        platform: "apple",
        bundle_id: "com.owlmetry.filter",
        project_id: project.id,
      },
    });
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_type: "project" },
    );
    const entries = res.json().audit_logs;
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.every((e: any) => e.resource_type === "project")).toBe(true);
  });

  it("resource_id filters to specific resource", async () => {
    const p1 = await createProject("P1", "p1");
    await createProject("P2", "p2");
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_id: p1.id },
    );
    const entries = res.json().audit_logs;
    expect(entries).toHaveLength(1);
    expect(entries[0].resource_id).toBe(p1.id);
  });

  it("actor_id filters to specific actor", async () => {
    await createProject("Actor Test", "actor-test");
    await waitForAuditWrites();

    // Get user id from token
    const meRes = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    const userId = meRes.json().user.id;

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { actor_id: userId, resource_type: "project" },
    );
    const entries = res.json().audit_logs;
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.every((e: any) => e.actor_id === userId)).toBe(true);
  });

  it("action filter returns only matching actions", async () => {
    const project = await createProject("Action Test", "action-test");

    // Update the project (generates "update" action)
    await app.inject({
      method: "PATCH",
      url: `/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Action Test Renamed" },
    });
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { action: "create", resource_type: "project" },
    );
    const entries = res.json().audit_logs;
    expect(entries.every((e: any) => e.action === "create")).toBe(true);
  });

  it("since filter excludes older entries", async () => {
    await createProject("Since Test", "since-test");
    await waitForAuditWrites();

    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { since: futureDate },
    );
    expect(res.json().audit_logs).toHaveLength(0);
  });

  it("until filter excludes newer entries", async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();

    await createProject("Until Test", "until-test");
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { until: pastDate },
    );
    const entries = res.json().audit_logs;
    expect(
      entries.every(
        (e: any) => new Date(e.timestamp).getTime() <= new Date(pastDate).getTime(),
      ),
    ).toBe(true);
  });

  it("combined filters work together", async () => {
    const project = await createProject("Combined", "combined");

    await app.inject({
      method: "PATCH",
      url: `/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Combined Renamed" },
    });
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_type: "project", action: "update" },
    );
    const entries = res.json().audit_logs;
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("update");
    expect(entries[0].resource_type).toBe("project");
  });
});

// ─── 4. Pagination ───────────────────────────────────────────────────────────

describe("Pagination", () => {
  it("limit returns correct number with has_more and cursor", async () => {
    await createProject("Page1", "page1");
    await createProject("Page2", "page2");
    await createProject("Page3", "page3");
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { limit: "2", resource_type: "project", action: "create" },
    );
    const body = res.json();

    expect(body.audit_logs).toHaveLength(2);
    expect(body.has_more).toBe(true);
    expect(body.cursor).toBeTruthy();
  });

  it("cursor returns next page with no overlap", async () => {
    await createProject("PageA", "page-a");
    await createProject("PageB", "page-b");
    await createProject("PageC", "page-c");
    await waitForAuditWrites();

    // First page
    const page1 = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { limit: "2", resource_type: "project", action: "create" },
    );
    const body1 = page1.json();

    // Second page
    const page2 = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      {
        limit: "2",
        cursor: body1.cursor,
        resource_type: "project",
        action: "create",
      },
    );
    const body2 = page2.json();

    const page1Ids = body1.audit_logs.map((e: any) => e.id);
    const page2Ids = body2.audit_logs.map((e: any) => e.id);

    // No overlap
    for (const id of page2Ids) {
      expect(page1Ids).not.toContain(id);
    }

    // Together we have all 3
    expect(page1Ids.length + page2Ids.length).toBe(3);
  });

  it("has_more is false and cursor is null when all results fit", async () => {
    await createProject("SinglePage", "single-page");
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { limit: "50", resource_type: "project", action: "create" },
    );
    const body = res.json();

    expect(body.has_more).toBe(false);
    expect(body.cursor).toBeNull();
  });
});

// ─── 5. Team Scoping ─────────────────────────────────────────────────────────

describe("Team Scoping", () => {
  it("cannot see another team's audit logs (403)", async () => {
    // Create a second user with their own team
    const { token: otherToken } = await createUserAndGetToken(
      app,
      "other@owlmetry.com",
    );

    // Try to access the seeded team's audit logs
    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/audit-logs`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("logs are correctly scoped when user is in multiple teams", async () => {
    // Second user creates their own team (auto-created via login)
    const { token: otherToken, teamId: otherTeamId } =
      await createUserAndGetToken(app, "multi@owlmetry.com");

    // Add the second user to our team as admin
    const meRes = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${otherToken}` },
    });
    const otherUserId = meRes.json().user.id;
    await addTeamMember(teamId, otherUserId, "admin");

    // Create a project in the second user's team
    await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { name: "Other Team Project", slug: "other-team", team_id: otherTeamId },
    });
    await waitForAuditWrites();

    // Query audit logs for our team — should not contain the other team's project
    const res = await getAuditLogs(
      { authorization: `Bearer ${otherToken}` },
      { resource_type: "project", action: "create" },
    );
    const entries = res.json().audit_logs;
    expect(entries.every((e: any) => e.team_id === teamId)).toBe(true);
  });
});

// ─── 6. Content Verification ─────────────────────────────────────────────────

describe("Content Verification", () => {
  it("user-initiated action has actor_type user", async () => {
    await createProject("User Actor", "user-actor");
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_type: "project", action: "create" },
    );
    const entry = res.json().audit_logs.find(
      (e: any) => e.metadata?.slug === "user-actor",
    );
    expect(entry).toBeDefined();
    expect(entry.actor_type).toBe("user");

    // actor_id should be the user's id
    const meRes = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(entry.actor_id).toBe(meRes.json().user.id);
  });

  it("agent-key-initiated action has actor_type api_key", async () => {
    // Create agent key with projects:write + audit_logs:read
    const agentKey = await createAgentKey(app, token, teamId, [
      "projects:write",
      "projects:read",
      "audit_logs:read",
    ]);
    await waitForAuditWrites(); // wait for key creation audit log

    // Create a project with the agent key
    await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${agentKey}` },
      payload: { name: "Agent Project", slug: "agent-project", team_id: teamId },
    });
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${agentKey}` },
      { resource_type: "project", action: "create" },
    );
    const entry = res.json().audit_logs.find(
      (e: any) => e.metadata?.slug === "agent-project",
    );
    expect(entry).toBeDefined();
    expect(entry.actor_type).toBe("api_key");
    expect(entry.actor_id).toBeDefined();
  });

  it("update action captures changes JSONB", async () => {
    const project = await createProject("Before Name", "changes-test");

    await app.inject({
      method: "PATCH",
      url: `/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "After Name" },
    });
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_type: "project", action: "update" },
    );
    const entry = res.json().audit_logs.find(
      (e: any) => e.resource_id === project.id,
    );
    expect(entry).toBeDefined();
    expect(entry.changes).toEqual({
      name: { before: "Before Name", after: "After Name" },
    });
  });

  it("create action captures metadata JSONB", async () => {
    const project = await createProject("Meta Project", "meta-project");
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_type: "project", resource_id: project.id },
    );
    const entry = res.json().audit_logs[0];
    expect(entry.metadata).toEqual({ name: "Meta Project", slug: "meta-project" });
  });
});

// ─── 7. Resource Type Coverage ───────────────────────────────────────────────

describe("Resource Type Coverage", () => {
  it("project create/update/delete entries logged", async () => {
    const project = await createProject("Lifecycle", "lifecycle");

    await app.inject({
      method: "PATCH",
      url: `/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Lifecycle Renamed" },
    });

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_type: "project", resource_id: project.id },
    );
    const actions = res.json().audit_logs.map((e: any) => e.action);
    expect(actions).toContain("create");
    expect(actions).toContain("update");
    expect(actions).toContain("delete");
  });

  it("app creation entry logged", async () => {
    const project = await createProject("App Test", "app-test");

    const appRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Audit App",
        platform: "backend",
        project_id: project.id,
      },
    });
    const createdApp = appRes.json();
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_type: "app", resource_id: createdApp.id },
    );
    const entry = res.json().audit_logs[0];
    expect(entry.action).toBe("create");
    expect(entry.resource_type).toBe("app");
    expect(entry.metadata).toMatchObject({ name: "Audit App", platform: "backend" });
  });

  it("API key creation and deletion entries logged", async () => {
    // Create a key via the API (POST /v1/auth/keys returns { key, api_key })
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Audit Agent Key",
        key_type: "agent",
        team_id: teamId,
        permissions: ["events:read"],
      },
    });
    const keyId = createRes.json().api_key.id;

    // Delete the key
    await app.inject({
      method: "DELETE",
      url: `/v1/auth/keys/${keyId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    await waitForAuditWrites();

    const res = await getAuditLogs(
      { authorization: `Bearer ${token}` },
      { resource_type: "api_key", resource_id: keyId },
    );
    const actions = res.json().audit_logs.map((e: any) => e.action);
    expect(actions).toContain("create");
    expect(actions).toContain("delete");
  });
});
