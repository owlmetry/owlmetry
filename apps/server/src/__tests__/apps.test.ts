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
});
