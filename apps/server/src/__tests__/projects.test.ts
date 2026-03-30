import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  createUserAndGetToken,
  addTeamMember,
  TEST_CLIENT_KEY,
  TEST_DB_URL,
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

describe("GET /v1/projects", () => {
  it("lists projects for the team", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projects).toHaveLength(3);
    const testProject = body.projects.find((p: any) => p.name === "Test Project");
    expect(testProject).toBeDefined();
    expect(body.projects[0].deleted_at).toBeUndefined();
  });

  it("does not list deleted projects", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().projects).toHaveLength(2);
  });
});

describe("GET /v1/projects/:id", () => {
  it("returns project with apps", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Test Project");
    expect(body.apps).toHaveLength(1);
    expect(body.apps[0].name).toBe("Test App");
  });

  it("excludes deleted apps from project detail", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().apps).toHaveLength(0);
  });

  it("returns 404 for deleted project", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/projects", () => {
  it("rejects missing fields in create", async () => {
    const { token } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Test" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid slug in create", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}` },
      payload: { team_id: teamId, name: "Test", slug: "Bad Slug!" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects duplicate slug in same team", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const first = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Dupe Test", slug: "dupe-test", team_id: teamId },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Dupe Test 2", slug: "dupe-test", team_id: teamId },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toContain("already exists");
  });
});

describe("PATCH /v1/projects/:id", () => {
  it("updates project name", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Renamed Project" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Renamed Project");
  });

  it("preserves other fields when updating name", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "New Name" },
    });

    const body = res.json();
    expect(body.slug).toBe("test-project");
    expect(body.team_id).toBe(testData.teamId);
  });

  it("rejects empty body", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/projects/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for deleted project", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects client key (no projects:write permission)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("data retention fields", () => {
  it("creates a project with retention fields", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        team_id: teamId,
        name: "Retention Test",
        slug: "retention-test",
        retention_days_events: 90,
        retention_days_metrics: 180,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.retention_days_events).toBe(90);
    expect(body.retention_days_metrics).toBe(180);
    expect(body.retention_days_funnels).toBeNull();
    expect(body.effective_retention_days_events).toBe(90);
    expect(body.effective_retention_days_metrics).toBe(180);
    expect(body.effective_retention_days_funnels).toBe(365);
  });

  it("returns effective defaults when retention is null", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retention_days_events).toBeNull();
    expect(body.effective_retention_days_events).toBe(120);
    expect(body.effective_retention_days_metrics).toBe(365);
    expect(body.effective_retention_days_funnels).toBe(365);
  });

  it("updates retention fields", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { retention_days_events: 60 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retention_days_events).toBe(60);
    expect(body.effective_retention_days_events).toBe(60);
  });

  it("resets retention to default with null", async () => {
    const token = await getToken(app);

    // First set a custom value
    await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { retention_days_events: 60 },
    });

    // Then reset to default
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { retention_days_events: null },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retention_days_events).toBeNull();
    expect(body.effective_retention_days_events).toBe(120);
  });

  it("rejects retention below minimum", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { retention_days_events: 0 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects retention above maximum", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { retention_days_events: 9999 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("allows update with only retention fields (no name)", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { retention_days_metrics: 730 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().retention_days_metrics).toBe(730);
    expect(res.json().name).toBe("Test Project"); // name unchanged
  });
});

describe("DELETE /v1/projects/:id", () => {
  it("soft-deletes a project", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("cascade soft-deletes apps within the project", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Apps under this project should also be soft-deleted
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listRes.json().apps).toHaveLength(2);
  });

  it("cascade soft-deletes api_keys and definitions within the project", async () => {
    const token = await getToken(app);

    // Create a metric definition and funnel definition in the project
    const client = postgres(TEST_DB_URL, { max: 1 });
    await client`
      INSERT INTO metric_definitions (project_id, name, slug)
      VALUES (${testData.projectId}, 'Test Metric', 'test-metric')
    `;
    await client`
      INSERT INTO funnel_definitions (project_id, name, slug, steps)
      VALUES (${testData.projectId}, 'Test Funnel', 'test-funnel', ${JSON.stringify([{ name: "step1", event_filter: { step_name: "step1" } }])}::jsonb)
    `;

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    // API keys for apps in this project should be soft-deleted
    const activeKeys = await client`
      SELECT id FROM api_keys
      WHERE app_id = ${testData.appId} AND deleted_at IS NULL
    `;
    expect(activeKeys).toHaveLength(0);

    // Metric and funnel definitions should be soft-deleted
    const activeMetrics = await client`
      SELECT id FROM metric_definitions
      WHERE project_id = ${testData.projectId} AND deleted_at IS NULL
    `;
    expect(activeMetrics).toHaveLength(0);

    const activeFunnels = await client`
      SELECT id FROM funnel_definitions
      WHERE project_id = ${testData.projectId} AND deleted_at IS NULL
    `;
    expect(activeFunnels).toHaveLength(0);

    await client.end();
  });

  it("returns 404 for non-existent project", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/projects/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when deleting an already-deleted project", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for project belonging to another team", async () => {
    const { token: otherToken } = await createUserAndGetToken(app, "other@owlmetry.com", "Other");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("member cannot delete project", async () => {
    const { userId: memberUserId, token: memberToken } = await createUserAndGetToken(app, "member@owlmetry.com", "Member");
    await addTeamMember(testData.teamId, memberUserId, "member");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("rejects client key (no projects:write permission)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
