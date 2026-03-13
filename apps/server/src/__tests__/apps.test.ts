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
  it("lists apps for the team", async () => {
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
    expect(body.apps[0].platform).toBe("ios");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/apps", () => {
  it("creates a new app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Android App",
        platform: "android",
        bundle_id: "dev.owlmetry.android",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Android App");
    expect(body.platform).toBe("android");
    expect(body.bundle_id).toBe("dev.owlmetry.android");
    expect(body.team_id).toBe(testData.teamId);
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
      payload: { name: "No Bundle", platform: "ios", project_id: testData.projectId },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/bundle_id/);
  });

  it("rejects API key auth (only users can create apps)", async () => {
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

  it("new app appears in list", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Second App", platform: "web", bundle_id: "owlmetry.dev", project_id: testData.projectId },
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
        platform: "ios",
        bundle_id: "dev.owlmetry.ghost",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /v1/apps/:id", () => {
  it("updates app name", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Renamed App" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Renamed App");
  });

  it("updates app bundle_id", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { bundle_id: "dev.owlmetry.updated" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().bundle_id).toBe("dev.owlmetry.updated");
  });

  it("updates multiple fields at once", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "New Name", bundle_id: "dev.owlmetry.new" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("New Name");
    expect(body.bundle_id).toBe("dev.owlmetry.new");
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

  it("returns 403 with API key auth", async () => {
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
      payload: { email: "other@owlmetry.dev", password: "pass123", name: "Other" },
    });
    const otherToken = regRes.json().token;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 403 with API key auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
