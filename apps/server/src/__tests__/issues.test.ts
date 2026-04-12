import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, truncateAll, seedTestData, getTokenAndTeamId, createAgentKey } from "./setup.js";
import postgres from "postgres";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || "postgresql://localhost:5432/owlmetry_test";

let app: FastifyInstance;
let token: string;
let teamId: string;
let projectId: string;
let appId: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
  const result = await getTokenAndTeamId(app);
  token = result.token;
  teamId = result.teamId;

  // Get project and app from seed data
  const projRes = await app.inject({
    method: "GET",
    url: "/v1/projects",
    headers: { Authorization: `Bearer ${token}` },
  });
  const projects = JSON.parse(projRes.body).projects;
  projectId = projects[0].id;

  const projDetail = await app.inject({
    method: "GET",
    url: `/v1/projects/${projectId}`,
    headers: { Authorization: `Bearer ${token}` },
  });
  appId = JSON.parse(projDetail.body).apps[0].id;
});

// Helper to create an issue directly in the DB
async function createTestIssue(overrides: {
  status?: string;
  title?: string;
  is_dev?: boolean;
  occurrence_count?: number;
  unique_user_count?: number;
  resolved_at_version?: string | null;
} = {}) {
  const client = postgres(TEST_DB_URL, { max: 1 });
  const now = new Date().toISOString();
  const title = overrides.title ?? "Test error message";

  const [issue] = await client`
    INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, occurrence_count, unique_user_count, resolved_at_version, first_seen_at, last_seen_at)
    VALUES (${appId}, ${projectId}, ${overrides.status ?? "new"}, ${title}, ${"TestModule"}, ${overrides.is_dev ?? false}, ${overrides.occurrence_count ?? 1}, ${overrides.unique_user_count ?? 1}, ${overrides.resolved_at_version ?? null}, ${now}, ${now})
    RETURNING id
  `;

  // Insert a fingerprint
  await client`
    INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id)
    VALUES (${`fp_${issue.id.slice(0, 8)}`}, ${appId}, ${overrides.is_dev ?? false}, ${issue.id})
  `;

  await client.end();
  return issue.id;
}

describe("Issues API", () => {
  describe("GET /v1/projects/:projectId/issues", () => {
    it("returns empty list initially", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.issues).toEqual([]);
      expect(body.has_more).toBe(false);
      expect(body.cursor).toBeNull();
    });

    it("returns issues sorted by unique_user_count DESC", async () => {
      await createTestIssue({ title: "Error A", unique_user_count: 5 });
      await createTestIssue({ title: "Error B", unique_user_count: 10 });
      await createTestIssue({ title: "Error C", unique_user_count: 2 });

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.issues).toHaveLength(3);
      expect(body.issues[0].unique_user_count).toBe(10);
      expect(body.issues[1].unique_user_count).toBe(5);
      expect(body.issues[2].unique_user_count).toBe(2);
    });

    it("filters by status", async () => {
      await createTestIssue({ status: "new" });
      await createTestIssue({ status: "resolved" });

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?status=new`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.issues).toHaveLength(1);
      expect(body.issues[0].status).toBe("new");
    });

    it("filters by is_dev", async () => {
      await createTestIssue({ is_dev: false });
      await createTestIssue({ is_dev: true });

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?is_dev=true`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.issues).toHaveLength(1);
      expect(body.issues[0].is_dev).toBe(true);
    });

    it("includes fingerprints and app_name", async () => {
      await createTestIssue();

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.issues[0].fingerprints).toBeInstanceOf(Array);
      expect(body.issues[0].fingerprints.length).toBeGreaterThan(0);
      expect(body.issues[0].app_name).toBeTruthy();
    });
  });

  describe("GET /v1/projects/:projectId/issues/:issueId", () => {
    it("returns issue detail with occurrences and comments", async () => {
      const issueId = await createTestIssue();

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe(issueId);
      expect(body.occurrences).toBeInstanceOf(Array);
      expect(body.comments).toBeInstanceOf(Array);
      expect(body.fingerprints).toBeInstanceOf(Array);
    });

    it("returns 404 for wrong project", async () => {
      const issueId = await createTestIssue();

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/00000000-0000-0000-0000-000000000000/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("PATCH /v1/projects/:projectId/issues/:issueId", () => {
    it("resolves an issue with version", async () => {
      const issueId = await createTestIssue({ status: "new" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "resolved", resolved_at_version: "2.0.0" },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("resolved");
      expect(body.resolved_at_version).toBe("2.0.0");
    });

    it("silences an issue", async () => {
      const issueId = await createTestIssue({ status: "new" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "silenced" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe("silenced");
    });

    it("reopens a resolved issue", async () => {
      const issueId = await createTestIssue({ status: "resolved", resolved_at_version: "1.0.0" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "new" },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("new");
      expect(body.resolved_at_version).toBeNull();
    });

    it("claims an issue (in_progress)", async () => {
      const issueId = await createTestIssue({ status: "new" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "in_progress" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe("in_progress");
    });

    it("rejects invalid status transition", async () => {
      const issueId = await createTestIssue({ status: "new" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "regressed" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain("Cannot transition");
    });
  });

  describe("POST /v1/projects/:projectId/issues/:issueId/merge", () => {
    it("merges source into target", async () => {
      const targetId = await createTestIssue({ title: "Target Error" });
      const sourceId = await createTestIssue({ title: "Source Error" });

      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${targetId}/merge`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { source_issue_id: sourceId },
      });
      expect(res.statusCode).toBe(200);

      // Target should have the merged fingerprints
      const body = JSON.parse(res.body);
      expect(body.id).toBe(targetId);
      expect(body.fingerprints.length).toBe(2);

      // Source should be deleted
      const sourceRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${sourceId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(sourceRes.statusCode).toBe(404);
    });

    it("rejects merging into itself", async () => {
      const issueId = await createTestIssue();

      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/merge`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { source_issue_id: issueId },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("Comments", () => {
    it("creates and lists comments", async () => {
      const issueId = await createTestIssue();

      // Create comment
      const createRes = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "Investigating this issue" },
      });
      expect(createRes.statusCode).toBe(201);
      const created = JSON.parse(createRes.body);
      expect(created.body).toBe("Investigating this issue");
      expect(created.author_type).toBe("user");

      // List comments
      const listRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.statusCode).toBe(200);
      const body = JSON.parse(listRes.body);
      expect(body.comments).toHaveLength(1);
      expect(body.comments[0].body).toBe("Investigating this issue");
    });

    it("edits own comment", async () => {
      const issueId = await createTestIssue();

      const createRes = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "Original text" },
      });
      const commentId = JSON.parse(createRes.body).id;

      const editRes = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments/${commentId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "Updated text" },
      });
      expect(editRes.statusCode).toBe(200);
      expect(JSON.parse(editRes.body).body).toBe("Updated text");
    });

    it("soft-deletes comment", async () => {
      const issueId = await createTestIssue();

      const createRes = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "To be deleted" },
      });
      const commentId = JSON.parse(createRes.body).id;

      const delRes = await app.inject({
        method: "DELETE",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments/${commentId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.statusCode).toBe(200);

      // Should not appear in list
      const listRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(JSON.parse(listRes.body).comments).toHaveLength(0);
    });

    it("agent key creates comment with author_type=agent", async () => {
      const issueId = await createTestIssue();
      const agentKey = await createAgentKey(app, token, teamId, ["issues:read", "issues:write"]);

      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${agentKey}` },
        payload: { body: "Agent investigation note" },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.author_type).toBe("agent");
      expect(body.body).toBe("Agent investigation note");
    });
  });

  describe("Agent key access", () => {
    it("agent key can list issues with issues:read", async () => {
      const agentKey = await createAgentKey(app, token, teamId, ["issues:read", "issues:write"]);
      await createTestIssue();

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${agentKey}` },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).issues).toHaveLength(1);
    });

    it("agent key can update issue status", async () => {
      const agentKey = await createAgentKey(app, token, teamId, ["issues:read", "issues:write"]);
      const issueId = await createTestIssue();

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${agentKey}` },
        payload: { status: "in_progress" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe("in_progress");
    });
  });

  describe("Project alert frequency", () => {
    it("updates issue_alert_frequency on project", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { issue_alert_frequency: "hourly" },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.issue_alert_frequency).toBe("hourly");
      expect(body.effective_issue_alert_frequency).toBe("hourly");
    });

    it("rejects invalid frequency", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { issue_alert_frequency: "every_minute" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
