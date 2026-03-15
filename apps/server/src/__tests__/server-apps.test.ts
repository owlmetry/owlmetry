import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
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
  it("creates a server app without bundle_id and returns owl_client_ key", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "API Server",
        platform: "backend",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("API Server");
    expect(body.platform).toBe("backend");
    expect(body.bundle_id).toBeNull();
    expect(body.client_key).toMatch(/^owl_client_/);
  });

  it("auto-created key for server app has client type with events:write", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Server Key App",
        platform: "backend",
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
    expect(autoKey.key_type).toBe("client");
    expect(autoKey.key_prefix).toMatch(/^owl_client_/);
  });

  it("ingests events with server app key (no bundle_id)", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Ingest Server",
        platform: "backend",
        project_id: testData.projectId,
      },
    });

    const clientKey = createRes.json().client_key;

    const ingestRes = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${clientKey}` },
      payload: {
        events: [
          { level: "info", message: "Server started", session_id: TEST_SESSION_ID, environment: "backend" },
        ],
      },
    });

    expect(ingestRes.statusCode).toBe(200);
    expect(ingestRes.json().accepted).toBe(1);
  });

  it("still requires bundle_id for non-backend platforms", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "No Bundle Apple",
        platform: "apple",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/bundle_id/);
  });

  it("rejects invalid platform value", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Invalid Platform",
        platform: "ios",
        bundle_id: "com.owlmetry.invalid",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid platform/);
  });

  it("app users upsert works for server app events", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "User Tracking Server",
        platform: "backend",
        project_id: testData.projectId,
      },
    });

    const clientKey = createRes.json().client_key;
    const serverAppId = createRes.json().id;

    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${clientKey}` },
      payload: {
        events: [
          { level: "info", message: "User action", session_id: TEST_SESSION_ID, user_id: "server-user-1", environment: "backend" },
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
