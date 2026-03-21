import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  createUserAndGetToken,
  testEmailService,
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

describe("POST /v1/auth/send-code", () => {
  it("sends code for any email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "anyone@owlmetry.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe("Verification code sent");
    expect(testEmailService.lastCode).toHaveLength(6);
    expect(testEmailService.lastEmail).toBe("anyone@owlmetry.com");
  });

  it("rejects missing email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "not-an-email" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rate limits after 5 requests", async () => {
    const email = "ratelimit@owlmetry.com";
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/auth/send-code",
        payload: { email },
      });
    }

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email },
    });

    expect(res.statusCode).toBe(429);
  });
});

describe("POST /v1/auth/verify-code", () => {
  it("authenticates existing user", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: TEST_USER.email },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: TEST_USER.email, code: testEmailService.lastCode },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe(TEST_USER.email);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].id).toBe(testData.teamId);
    expect(body.is_new_user).toBe(false);
  });

  it("creates new user and team for unknown email", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "newuser@owlmetry.com" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: "newuser@owlmetry.com", code: testEmailService.lastCode },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe("newuser@owlmetry.com");
    expect(body.user.name).toBe("Newuser");
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].role).toBe("owner");
    expect(body.is_new_user).toBe(true);
  });

  it("rejects invalid code", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: TEST_USER.email },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: TEST_USER.email, code: "000000" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects already-used code", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: TEST_USER.email },
    });

    const code = testEmailService.lastCode;

    // Use it once
    await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: TEST_USER.email, code },
    });

    // Try again
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: TEST_USER.email, code },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects missing fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: TEST_USER.email },
    });

    expect(res.statusCode).toBe(400);
  });

  it("sets JWT cookie", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: TEST_USER.email },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: TEST_USER.email, code: testEmailService.lastCode },
    });

    const cookies = res.cookies;
    const tokenCookie = cookies.find((c: { name: string }) => c.name === "token");
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie!.httpOnly).toBe(true);
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
    // seed creates 5 keys: client, agent, backend client, android client, expired
    expect(body.api_keys).toHaveLength(5);
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
    // Create a second user (gets their own team)
    const { token: otherToken } = await createUserAndGetToken(app, "other@owlmetry.com");

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
    const { token: otherToken } = await createUserAndGetToken(app, "other@owlmetry.com");

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

  it("rejects key creation with missing name", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        key_type: "agent",
        team_id: teamId,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("name and key_type required");
  });

  it("rejects key creation for app in different team", async () => {
    const token = await getToken(app);

    // Create a second user with their own team and app
    const { token: otherToken, teamId: otherTeamId } = await createUserAndGetToken(app, "other@owlmetry.com", "Other");

    // Create a project in the other team
    const projRes = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { name: "Other Project", slug: "other-project", team_id: otherTeamId },
    });
    const otherProjectId = projRes.json().id;

    // Create an app in the other team
    const appRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { name: "Other App", platform: "apple", bundle_id: "com.other.test", project_id: otherProjectId },
    });
    const otherAppId = appRes.json().id;

    // First user tries to create a key for the other team's app
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Cross-team key",
        key_type: "client",
        app_id: otherAppId,
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("App not found");
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

