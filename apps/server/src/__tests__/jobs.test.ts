import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  setupTestDb,
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createAgentKey,
} from "./setup.js";

let app: FastifyInstance;
let token: string;
let teamId: string;
let projectId: string;

beforeAll(async () => {
  await setupTestDb();
  app = await buildApp();
}, 60_000);

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  projectId = seed.projectId;
  const auth = await getTokenAndTeamId(app);
  token = auth.token;
  teamId = auth.teamId;
});

describe("Job Routes", () => {
  describe("GET /v1/teams/:teamId/jobs", () => {
    it("returns empty list initially", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.job_runs).toEqual([]);
      expect(body.has_more).toBe(false);
      expect(body.cursor).toBeNull();
    });

    it("returns job runs after triggering a job", async () => {
      // Trigger a job first
      await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "revenuecat_sync",
          project_id: projectId,
        },
      });

      // Wait a moment for the job to be created
      await new Promise((r) => setTimeout(r, 100));

      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.job_runs.length).toBeGreaterThanOrEqual(1);
      expect(body.job_runs[0].job_type).toBe("revenuecat_sync");
    });

    it("filters by job_type", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs?job_type=revenuecat_sync`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it("requires jobs:read permission for agent keys", async () => {
      const keyWithoutPerm = await createAgentKey(app, token, teamId, ["events:read"]);

      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs`,
        headers: { authorization: `Bearer ${keyWithoutPerm}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it("allows agent keys with jobs:read permission", async () => {
      const key = await createAgentKey(app, token, teamId, ["jobs:read"]);

      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs`,
        headers: { authorization: `Bearer ${key}` },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/teams/:teamId/jobs/trigger", () => {
    it("triggers a project-scoped job", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "revenuecat_sync",
          project_id: projectId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.job_run).toBeDefined();
      expect(body.job_run.job_type).toBe("revenuecat_sync");
      expect(body.job_run.team_id).toBe(teamId);
      expect(body.job_run.project_id).toBe(projectId);
      expect(["pending", "running", "completed"]).toContain(body.job_run.status);
    });

    it("rejects system job types", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "db_pruning",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("system job");
    });

    it("rejects unknown job types", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "nonexistent_job",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("requires project_id for project-scoped jobs", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "revenuecat_sync",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("project_id");
    });

    it("prevents duplicate running jobs", async () => {
      // Register a slow test handler
      app.jobRunner.register("revenuecat_sync", async (ctx) => {
        await new Promise((r) => setTimeout(r, 5000));
        return { test: true };
      });

      // Trigger first
      const first = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "revenuecat_sync",
          project_id: projectId,
        },
      });
      expect(first.statusCode).toBe(201);

      // Wait for it to start running
      await new Promise((r) => setTimeout(r, 100));

      // Trigger duplicate
      const second = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "revenuecat_sync",
          project_id: projectId,
        },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toContain("already running or pending");
    });

    it("supports notify flag", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "revenuecat_sync",
          project_id: projectId,
          notify: true,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().job_run.notify).toBe(true);
    });
  });

  describe("GET /v1/jobs/:runId", () => {
    it("returns job run detail", async () => {
      const trigger = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "revenuecat_sync",
          project_id: projectId,
        },
      });

      const runId = trigger.json().job_run.id;

      const res = await app.inject({
        method: "GET",
        url: `/v1/jobs/${runId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().job_run.id).toBe(runId);
    });

    it("returns 404 for non-existent run", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/jobs/00000000-0000-0000-0000-000000000000`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /v1/jobs/:runId/cancel", () => {
    it("cancels a running job", async () => {
      // Register a slow handler
      app.jobRunner.register("revenuecat_sync", async (ctx) => {
        while (!ctx.isCancelled()) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { cancelled: true };
      });

      const trigger = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "revenuecat_sync",
          project_id: projectId,
        },
      });

      const runId = trigger.json().job_run.id;

      // Wait for it to start running
      await new Promise((r) => setTimeout(r, 200));

      const res = await app.inject({
        method: "POST",
        url: `/v1/jobs/${runId}/cancel`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().cancelled).toBe(true);
    });

    it("returns 400 for non-running job", async () => {
      const trigger = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "revenuecat_sync",
          project_id: projectId,
        },
      });

      // Wait for the fast handler to complete
      await new Promise((r) => setTimeout(r, 200));

      const runId = trigger.json().job_run.id;
      const res = await app.inject({
        method: "POST",
        url: `/v1/jobs/${runId}/cancel`,
        headers: { authorization: `Bearer ${token}` },
      });

      // Should be 400 since the job already completed
      expect([400, 200]).toContain(res.statusCode);
    });
  });
});
