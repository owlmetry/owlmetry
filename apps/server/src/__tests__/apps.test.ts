import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  TEST_USER,
  TEST_AGENT_KEY,
  TEST_CLIENT_KEY,
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

describe("GET /v1/apps", () => {
  it("lists apps with client keys", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.apps).toHaveLength(1);
    expect(body.apps[0].name).toBe("Test App");
    expect(body.apps[0].platform).toBe("apple");
    expect(body.apps[0].client_key).toBe(TEST_CLIENT_KEY);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/apps/:id", () => {
  it("returns app by id", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(testData.appId);
    expect(body.name).toBe("Test App");
    expect(body.platform).toBe("apple");
    expect(body.client_key).toBe(TEST_CLIENT_KEY);
    expect(body.created_at).toBeDefined();
  });

  it("returns 404 for non-existent app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for deleted app", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for app in another team", async () => {
    const regRes = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "other@owlmetry.com", password: "pass123", name: "Other" },
    });
    const otherToken = regRes.json().token;

    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${testData.appId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects client key (no apps:read permission)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/apps", () => {
  it("creates a new app with auto-generated client key", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Android App",
        platform: "android",
        bundle_id: "com.owlmetry.android",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Android App");
    expect(body.platform).toBe("android");
    expect(body.bundle_id).toBe("com.owlmetry.android");
    expect(body.team_id).toBe(testData.teamId);
    expect(body.client_key).toMatch(/^owl_client_/);
  });

  it("auto-created client key appears in keys list", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Key List App",
        platform: "apple",
        bundle_id: "com.owlmetry.keylist",
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
  });

  it("auto-created client key works for ingest", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Ingest App",
        platform: "apple",
        bundle_id: "com.owlmetry.ingest",
        project_id: testData.projectId,
      },
    });

    const body = createRes.json();
    const clientKey = body.client_key;

    const ingestRes = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${clientKey}` },
      payload: {
        bundle_id: "com.owlmetry.ingest",
        events: [
          { level: "info", message: "test event", session_id: TEST_SESSION_ID },
        ],
      },
    });

    expect(ingestRes.statusCode).toBe(200);
  });

  it("client key is consistent between create and list", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Consistent App",
        platform: "apple",
        bundle_id: "com.owlmetry.consistent",
        project_id: testData.projectId,
      },
    });

    const createdKey = createRes.json().client_key;

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });

    const listedApp = listRes.json().apps.find(
      (a: { bundle_id: string }) => a.bundle_id === "com.owlmetry.consistent"
    );
    expect(listedApp.client_key).toBe(createdKey);
  });

  it("rejects missing required fields", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "No Platform" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects missing bundle_id", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "No Bundle", platform: "apple", project_id: testData.projectId },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/bundle_id/);
  });

  it("rejects client key (no apps:write permission)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        name: "Nope",
        platform: "apple",
        bundle_id: "com.owlmetry.nope",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it("new app appears in list", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Second App", platform: "web", bundle_id: "owlmetry.com", project_id: testData.projectId },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().apps).toHaveLength(2);
  });

  it("cannot create app under a deleted project", async () => {
    const token = await getToken(app);

    // Delete the project first
    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Ghost App",
        platform: "apple",
        bundle_id: "com.owlmetry.ghost",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /v1/apps/:id", () => {
  it("updates app name and preserves client key", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Renamed App" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Renamed App");
    expect(body.client_key).toBe(TEST_CLIENT_KEY);
  });

  it("ignores bundle_id in update payload", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { bundle_id: "com.owlmetry.updated" },
    });

    // bundle_id is not an updatable field, so this is treated as an empty update
    expect(res.statusCode).toBe(400);
  });

  it("rejects empty body", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for non-existent app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/apps/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects client key (no apps:write permission)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("cannot update a deleted app", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /v1/apps/:id", () => {
  it("soft-deletes an app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);

    // Verify it no longer appears in the list
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listRes.json().apps).toHaveLength(0);
  });

  it("returns 404 for non-existent app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/apps/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when deleting an already-deleted app", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for app belonging to another team", async () => {
    const regRes = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "other@owlmetry.com", password: "pass123", name: "Other" },
    });
    const otherToken = regRes.json().token;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects client key (no apps:write permission)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
