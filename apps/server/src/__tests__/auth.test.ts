import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  TEST_USER,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
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

describe("POST /v1/auth/register", () => {
  it("creates user and default team", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: "new@owlmetry.dev",
        password: "password123",
        name: "New User",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe("new@owlmetry.dev");
    expect(body.user.name).toBe("New User");
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].role).toBe("owner");
  });

  it("rejects duplicate email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: TEST_USER.email,
        password: "password123",
        name: "Duplicate",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already registered/i);
  });

  it("rejects missing fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "no@pass.com" },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/auth/login", () => {
  it("returns JWT and team list", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe(TEST_USER.email);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].id).toBe(testData.teamId);
    expect(body.teams[0].role).toBe("owner");
  });

  it("rejects wrong password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: TEST_USER.email,
        password: "wrongpassword",
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects non-existent user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "nobody@owlmetry.dev",
        password: "password123",
      },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/auth/teams", () => {
  it("lists teams for authenticated user", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/teams",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].id).toBe(testData.teamId);
    expect(body.teams[0].role).toBe("owner");
  });
});

describe("GET /v1/auth/me", () => {
  it("returns user profile and teams", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe(TEST_USER.email);
    expect(body.user.name).toBe(TEST_USER.name);
    expect(body.user.id).toBe(testData.userId);
    expect(body.user.created_at).toBeDefined();
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].role).toBe("owner");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with API key auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/auth/keys", () => {
  it("lists API keys for user teams", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // seed creates 3 keys: client, agent, expired
    expect(body.api_keys).toHaveLength(3);
    expect(body.api_keys[0].key_prefix).toBeDefined();
    expect(body.api_keys[0].created_at).toBeDefined();
  });

  it("does not expose key_hash", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json();
    for (const key of body.api_keys) {
      expect(key.key_hash).toBeUndefined();
    }
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with API key auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/auth/keys/:id", () => {
  it("deletes an API key", async () => {
    const token = await getToken(app);

    // Create a key to delete
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "To Delete",
        key_type: "client",
        app_id: testData.appId,
      },
    });
    const keyId = createRes.json().api_key.id;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/auth/keys/${keyId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);

    // Verify it's gone
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
    });
    const ids = listRes.json().api_keys.map((k: { id: string }) => k.id);
    expect(ids).not.toContain(keyId);
  });

  it("returns 404 for non-existent key", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/auth/keys/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for key belonging to another team", async () => {
    // Register a second user (gets their own team)
    const regRes = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "other@owlmetry.dev", password: "pass123", name: "Other" },
    });
    const otherToken = regRes.json().token;

    // Get a key ID from the original team
    const token = await getToken(app);
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
    });
    const keyId = listRes.json().api_keys[0].id;

    // Try to delete from other user
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/auth/keys/${keyId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/auth/keys/some-id",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with API key auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/auth/keys/some-id",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/auth/me", () => {
  it("updates user name", async () => {
    const token = await getToken(app);

    // Fetch current profile to capture original updated_at
    const before = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    const originalUpdatedAt = before.json().user.updated_at;

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Updated Name" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe("Updated Name");
    expect(res.json().user.updated_at).toBeDefined();
    expect(new Date(res.json().user.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdatedAt).getTime()
    );
  });

  it("updates user password", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { password: "newpassword123" },
    });

    expect(res.statusCode).toBe(200);

    // Verify new password works for login
    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: TEST_USER.email, password: "newpassword123" },
    });
    expect(loginRes.statusCode).toBe(200);
  });

  it("rejects empty body", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      payload: { name: "Nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with API key auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { name: "Nope" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/auth/keys/:id", () => {
  it("returns a single API key", async () => {
    const token = await getToken(app);

    // Get a key ID from the list
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
    });
    const keyId = listRes.json().api_keys[0].id;

    const res = await app.inject({
      method: "GET",
      url: `/v1/auth/keys/${keyId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.api_key.id).toBe(keyId);
    expect(body.api_key.key_prefix).toBeDefined();
    expect(body.api_key.created_at).toBeDefined();
    expect(body.api_key.key_hash).toBeUndefined();
  });

  it("returns 404 for non-existent key", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/keys/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for key belonging to another team", async () => {
    const regRes = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "other@owlmetry.dev", password: "pass123", name: "Other" },
    });
    const otherToken = regRes.json().token;

    const token = await getToken(app);
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
    });
    const keyId = listRes.json().api_keys[0].id;

    const res = await app.inject({
      method: "GET",
      url: `/v1/auth/keys/${keyId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 with API key auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/keys/some-id",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/auth/keys", () => {
  it("generates client API key scoped to app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "My Client Key",
        key_type: "client",
        app_id: testData.appId,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toMatch(/^owl_client_/);
    expect(body.api_key.key_type).toBe("client");
    expect(body.api_key.permissions).toContain("events:write");
  });

  it("generates agent API key with team_id", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "My Agent Key",
        key_type: "agent",
        team_id: teamId,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toMatch(/^owl_agent_/);
    expect(body.api_key.permissions).toContain("events:read");
  });

  it("rejects agent key without team_id or app_id", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Bad Agent Key",
        key_type: "agent",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/team_id/);
  });

  it("rejects client key without app_id", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Bad Key",
        key_type: "client",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects API key auth (only users can create keys)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        name: "Nope",
        key_type: "agent",
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      payload: {
        name: "No Auth",
        key_type: "agent",
      },
    });

    expect(res.statusCode).toBe(401);
  });
});
