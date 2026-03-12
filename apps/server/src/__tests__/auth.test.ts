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
