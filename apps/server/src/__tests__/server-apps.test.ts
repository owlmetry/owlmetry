import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  TEST_SESSION_ID,
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

describe("server platform apps", () => {
  it("creates a server app without bundle_id and returns owl_server_ key", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "API Server",
        platform: "server",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("API Server");
    expect(body.platform).toBe("server");
    expect(body.bundle_id).toBeNull();
    expect(body.client_key).toMatch(/^owl_server_/);
  });

  it("auto-created server key has events:write permission", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Server Key App",
        platform: "server",
        project_id: testData.projectId,
      },
    });

    const appId = createRes.json().id;

    const keysRes = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
    });

    const keys = keysRes.json().api_keys;
    const autoKey = keys.find((k: { app_id: string }) => k.app_id === appId);
    expect(autoKey).toBeDefined();
    expect(autoKey.key_type).toBe("server");
    expect(autoKey.key_prefix).toMatch(/^owl_server_/);
  });

  it("ingests events with server key (no bundle_id)", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Ingest Server",
        platform: "server",
        project_id: testData.projectId,
      },
    });

    const serverKey = createRes.json().client_key;

    const ingestRes = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${serverKey}` },
      payload: {
        events: [
          { level: "info", message: "Server started", session_id: TEST_SESSION_ID, platform: "server" },
        ],
      },
    });

    expect(ingestRes.statusCode).toBe(200);
    expect(ingestRes.json().accepted).toBe(1);
  });

  it("still requires bundle_id for non-server platforms", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "No Bundle iOS",
        platform: "ios",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/bundle_id/);
  });

  it("creates server API key via /v1/auth/keys", async () => {
    const token = await getToken(app);

    // First create a server app
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Server for Key",
        platform: "server",
        project_id: testData.projectId,
      },
    });
    const serverAppId = createRes.json().id;

    // Create additional server key
    const keyRes = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Extra Server Key",
        key_type: "server",
        app_id: serverAppId,
      },
    });

    expect(keyRes.statusCode).toBe(201);
    expect(keyRes.json().key).toMatch(/^owl_server_/);
    expect(keyRes.json().api_key.key_type).toBe("server");
  });

  it("rejects server key creation without app_id", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "No App Server Key",
        key_type: "server",
        team_id: teamId,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/app_id/);
  });

  it("app users upsert works for server app events", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "User Tracking Server",
        platform: "server",
        project_id: testData.projectId,
      },
    });

    const serverKey = createRes.json().client_key;
    const serverAppId = createRes.json().id;

    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${serverKey}` },
      payload: {
        events: [
          { level: "info", message: "User action", session_id: TEST_SESSION_ID, user_id: "server-user-1", platform: "server" },
        ],
      },
    });

    // Give fire-and-forget time to complete
    await new Promise((r) => setTimeout(r, 100));

    const usersRes = await app.inject({
      method: "GET",
      url: `/v1/apps/${serverAppId}/users`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(usersRes.statusCode).toBe(200);
    const users = usersRes.json().users;
    expect(users.some((u: { user_id: string }) => u.user_id === "server-user-1")).toBe(true);
  });
});
