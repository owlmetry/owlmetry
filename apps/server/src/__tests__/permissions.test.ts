import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { validatePermissionsForKeyType } from "@owlmetry/shared";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createAgentKey,
  TEST_DB_URL,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_BUNDLE_ID,
} from "./setup.js";

let app: FastifyInstance;
let testData: { userId: string; teamId: string; projectId: string; appId: string };

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  testData = await seedTestData();
});

afterAll(async () => {
  await app.close();
});

// ─── validatePermissionsForKeyType (unit tests) ──────────────────────

describe("validatePermissionsForKeyType", () => {
  it("accepts valid client permissions", () => {
    expect(validatePermissionsForKeyType("client", ["events:write"])).toBeNull();
  });

  it("accepts valid agent permissions", () => {
    expect(validatePermissionsForKeyType("agent", ["events:read", "funnels:read"])).toBeNull();
  });

  it("accepts all agent permissions", () => {
    expect(
      validatePermissionsForKeyType("agent", [
        "events:read",
        "funnels:read",
        "apps:read",
        "apps:write",
        "projects:read",
        "projects:write",
        "keys:manage",
      ])
    ).toBeNull();
  });

  it("rejects empty permissions array", () => {
    expect(validatePermissionsForKeyType("agent", [])).toMatch(/at least one/i);
  });

  it("rejects duplicate permissions", () => {
    expect(validatePermissionsForKeyType("agent", ["events:read", "events:read"])).toMatch(
      /duplicate/i
    );
  });

  it("rejects unknown permissions", () => {
    expect(validatePermissionsForKeyType("agent", ["events:read", "bogus:perm"])).toMatch(
      /unknown/i
    );
  });

  it("rejects events:read for client keys", () => {
    expect(validatePermissionsForKeyType("client", ["events:read"])).toMatch(/not allowed.*client/);
  });

  it("rejects events:write for agent keys", () => {
    expect(validatePermissionsForKeyType("agent", ["events:write"])).toMatch(/not allowed.*agent/);
  });

  it("rejects apps:write for client keys", () => {
    expect(validatePermissionsForKeyType("client", ["apps:write"])).toMatch(/not allowed.*client/);
  });
});

// ─── Custom permissions at key creation ──────────────────────────────

describe("Custom permissions at key creation", () => {
  it("creates agent key with custom permission subset", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Custom Agent",
        key_type: "agent",
        team_id: teamId,
        permissions: ["apps:read", "apps:write"],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.api_key.permissions).toEqual(["apps:read", "apps:write"]);
    expect(body.api_key.permissions).not.toContain("events:read");
  });

  it("creates agent key with all agent permissions", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Full Agent",
        key_type: "agent",
        team_id: teamId,
        permissions: [
          "events:read",
          "funnels:read",
          "apps:read",
          "apps:write",
          "projects:read",
          "projects:write",
          "keys:manage",
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().api_key.permissions).toHaveLength(7);
  });

  it("uses default permissions when none specified", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Default Agent",
        key_type: "agent",
        team_id: teamId,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().api_key.permissions).toEqual([
      "events:read",
      "funnels:read",
      "apps:read",
      "projects:read",
    ]);
  });

  it("rejects unknown permission in request", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Bad Perms",
        key_type: "agent",
        team_id: teamId,
        permissions: ["events:read", "bogus:perm"],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unknown/i);
  });

  it("rejects duplicate permissions in request", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Dupes",
        key_type: "agent",
        team_id: teamId,
        permissions: ["events:read", "events:read"],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/duplicate/i);
  });

  it("rejects empty permissions array in request", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Empty",
        key_type: "agent",
        team_id: teamId,
        permissions: [],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/at least one/i);
  });

  it("rejects events:write for agent key", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Bad Agent",
        key_type: "agent",
        team_id: teamId,
        permissions: ["events:write"],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not allowed.*agent/);
  });

  it("rejects events:read for client key", async () => {
    const { token } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Bad Client",
        key_type: "client",
        app_id: testData.appId,
        permissions: ["events:read"],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not allowed.*client/);
  });

  it("rejects invalid key_type", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Bad Type",
        key_type: "admin",
        team_id: teamId,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/key_type/);
  });
});

// ─── API key permission enforcement — apps routes ────────────────────

describe("API key permission enforcement — apps routes", () => {
  it("agent key with apps:read can list apps", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().apps).toHaveLength(1);
  });

  it("agent key without apps:read cannot list apps", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["events:read"]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/apps:read/);
  });

  it("agent key with apps:write can create app", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["apps:write"]);

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${key}` },
      payload: {
        name: "Agent Created App",
        platform: "android",
        bundle_id: "dev.owlmetry.agent",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("Agent Created App");
  });

  it("agent key without apps:write cannot create app", async () => {
    // TEST_AGENT_KEY has apps:read but NOT apps:write
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
      payload: {
        name: "Nope",
        platform: "ios",
        bundle_id: "dev.owlmetry.nope",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/apps:write/);
  });

  it("client key without apps:write cannot create app", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        name: "Nope",
        platform: "ios",
        bundle_id: "dev.owlmetry.nope",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it("agent key with apps:write can update app", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["apps:write"]);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${key}` },
      payload: { name: "Agent Updated" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Agent Updated");
  });

  it("agent key without apps:write cannot update app", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("agent key with apps:write can delete app", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["apps:write"]);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("agent key without apps:write cannot delete app", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── API key permission enforcement — projects routes ────────────────

describe("API key permission enforcement — projects routes", () => {
  it("agent key with projects:read can list projects", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toHaveLength(1);
  });

  it("agent key without projects:read cannot list projects", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["events:read"]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/projects:read/);
  });

  it("agent key with projects:read can get project detail", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Test Project");
    expect(res.json().apps).toHaveLength(1);
  });

  it("agent key with projects:write can create project", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["projects:write"]);

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${key}` },
      payload: { team_id: teamId, name: "Agent Project", slug: "agent-project" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("Agent Project");
  });

  it("agent key without projects:write cannot create project", async () => {
    const { teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
      payload: { team_id: teamId, name: "Nope", slug: "nope" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/projects:write/);
  });

  it("agent key with projects:write can update project", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["projects:write"]);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${key}` },
      payload: { name: "Agent Updated" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Agent Updated");
  });

  it("agent key without projects:write cannot update project", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("agent key with projects:write can delete project", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["projects:write"]);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("agent key without projects:write cannot delete project", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("agent key with apps:write can create app under project", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["apps:write"]);

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${testData.projectId}/apps`,
      headers: { authorization: `Bearer ${key}` },
      payload: {
        name: "Agent App",
        platform: "android",
        bundle_id: "dev.owlmetry.agentapp",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("Agent App");
  });

  it("agent key without apps:write cannot create app under project", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${testData.projectId}/apps`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
      payload: {
        name: "Nope",
        platform: "ios",
        bundle_id: "dev.owlmetry.nope",
      },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── API key permission enforcement — events routes ──────────────────

describe("API key permission enforcement — events routes", () => {
  async function ingestEvent() {
    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [{ level: "info", message: "perm test" }],
      },
    });
  }

  it("agent key with events:read can query events", async () => {
    await ingestEvent();

    const res = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(1);
  });

  it("agent key without events:read cannot query events", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["apps:read"]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/events:read/);
  });

  it("client key with events:write can ingest", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [{ level: "info", message: "client ingest" }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);
  });

  it("agent key without events:write cannot ingest", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [{ level: "info", message: "nope" }],
      },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── API key team boundary enforcement ───────────────────────────────

describe("API key team boundary enforcement", () => {
  let otherTeamToken: string;
  let otherTeamId: string;
  let otherProjectId: string;
  let otherAppId: string;

  beforeEach(async () => {
    // Register a second user (gets their own team)
    const regRes = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "other@owlmetry.dev", password: "pass123", name: "Other" },
    });
    otherTeamToken = regRes.json().token;
    otherTeamId = regRes.json().teams[0].id;

    // Create a project and app in the other team
    const projRes = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${otherTeamToken}` },
      payload: { team_id: otherTeamId, name: "Other Project", slug: "other-project" },
    });
    otherProjectId = projRes.json().id;

    const appRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${otherProjectId}/apps`,
      headers: { authorization: `Bearer ${otherTeamToken}` },
      payload: { name: "Other App", platform: "ios", bundle_id: "dev.other.app" },
    });
    otherAppId = appRes.json().id;
  });

  it("agent key cannot list other team's apps", async () => {
    // TEST_AGENT_KEY belongs to testData.teamId — it should only see that team's apps
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    const appIds = res.json().apps.map((a: any) => a.id);
    expect(appIds).toContain(testData.appId);
    expect(appIds).not.toContain(otherAppId);
  });

  it("agent key cannot list other team's projects", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    const projectIds = res.json().projects.map((p: any) => p.id);
    expect(projectIds).toContain(testData.projectId);
    expect(projectIds).not.toContain(otherProjectId);
  });

  it("agent key cannot get other team's project detail", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${otherProjectId}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("agent key with apps:write cannot create app under other team's project", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["apps:write"]);

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${otherProjectId}/apps`,
      headers: { authorization: `Bearer ${key}` },
      payload: { name: "Sneaky", platform: "ios", bundle_id: "dev.sneaky.app" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("agent key with apps:write cannot update other team's app", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["apps:write"]);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${otherAppId}`,
      headers: { authorization: `Bearer ${key}` },
      payload: { name: "Hacked" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("agent key with apps:write cannot delete other team's app", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["apps:write"]);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${otherAppId}`,
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("agent key with projects:write cannot update other team's project", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["projects:write"]);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${otherProjectId}`,
      headers: { authorization: `Bearer ${key}` },
      payload: { name: "Hacked" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("agent key with projects:write cannot delete other team's project", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["projects:write"]);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${otherProjectId}`,
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("agent key with projects:write cannot create project in other team", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const key = await createAgentKey(app, token, teamId, ["projects:write"]);

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${key}` },
      payload: { team_id: otherTeamId, name: "Sneaky", slug: "sneaky" },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Soft-deleted and expired key rejection ──────────────────────────

describe("Soft-deleted key rejection", () => {
  it("soft-deleted key cannot authenticate", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    // Create a key
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "To Delete",
        key_type: "agent",
        team_id: teamId,
        permissions: ["events:read"],
      },
    });
    const fullKey = createRes.json().key;
    const keyId = createRes.json().api_key.id;

    // Verify it works before deletion
    const beforeRes = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: `Bearer ${fullKey}` },
    });
    expect(beforeRes.statusCode).toBe(200);

    // Soft-delete the key
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/auth/keys/${keyId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteRes.statusCode).toBe(200);

    // Verify it's rejected after deletion
    const afterRes = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: `Bearer ${fullKey}` },
    });
    expect(afterRes.statusCode).toBe(401);
    expect(afterRes.json().error).toMatch(/invalid/i);
  });

  it("soft-deleted key no longer appears in key list", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Doomed", key_type: "agent", team_id: teamId },
    });
    const keyId = createRes.json().api_key.id;

    await app.inject({
      method: "DELETE",
      url: `/v1/auth/keys/${keyId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
    });
    const ids = listRes.json().api_keys.map((k: any) => k.id);
    expect(ids).not.toContain(keyId);
  });
});

// ─── JWT user permission bypass ──────────────────────────────────────

describe("JWT user permission bypass", () => {
  it("JWT user can access all routes regardless of permissions", async () => {
    const { token } = await getTokenAndTeamId(app);

    // Users don't need explicit permissions — they bypass permission checks
    const appsRes = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(appsRes.statusCode).toBe(200);

    const projectsRes = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(projectsRes.statusCode).toBe(200);
  });

  it("JWT member can read but not write", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    // Register a second user and add as member
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "member@owlmetry.dev", password: "pass123", name: "Member" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "member@owlmetry.dev", role: "member" },
    });
    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "member@owlmetry.dev", password: "pass123" },
    });
    const memberToken = loginRes.json().token;

    // Member can read
    const readRes = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(readRes.statusCode).toBe(200);

    // Member cannot write (role check, not permission check)
    const writeRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        name: "Nope",
        platform: "ios",
        bundle_id: "dev.nope",
        project_id: testData.projectId,
      },
    });
    expect(writeRes.statusCode).toBe(403);
  });

  it("JWT user cannot access other team's resources", async () => {
    // Register second user (gets their own team)
    const regRes = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "outsider@owlmetry.dev", password: "pass123", name: "Outsider" },
    });
    const outsiderToken = regRes.json().token;

    // Cannot get test team's project
    const projRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(projRes.statusCode).toBe(404);

    // Cannot delete test team's app
    const delRes = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(delRes.statusCode).toBe(404);
  });
});

// ─── Auth endpoint user-only enforcement ─────────────────────────────

describe("Auth endpoints reject API keys", () => {
  it("agent key cannot access GET /v1/auth/me", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("agent key cannot access GET /v1/auth/keys", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("agent key cannot create keys via POST /v1/auth/keys", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
      payload: { name: "Nope", key_type: "agent", team_id: testData.teamId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("agent key cannot delete keys via DELETE /v1/auth/keys/:id", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/auth/keys/some-id",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("agent key cannot update profile via PATCH /v1/auth/me", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
      payload: { name: "Nope" },
    });
    expect(res.statusCode).toBe(403);
  });
});
