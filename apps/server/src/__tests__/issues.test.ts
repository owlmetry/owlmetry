import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, truncateAll, seedTestData, getTokenAndTeamId, createAgentKey, createUserAndGetToken, addTeamMember, TEST_CLIENT_KEY, TEST_SESSION_ID, TEST_BUNDLE_ID } from "./setup.js";
import postgres from "postgres";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || "postgresql://localhost:5432/owlmetry_test";

let app: FastifyInstance;
let token: string;
let teamId: string;
let projectId: string;
let appId: string;
let dbClient: postgres.Sql;

beforeAll(async () => {
  app = await buildApp();
  dbClient = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await dbClient.end();
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
  const result = await getTokenAndTeamId(app);
  token = result.token;
  teamId = result.teamId;

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
  source_module?: string | null;
} = {}) {
  const now = new Date().toISOString();
  const title = overrides.title ?? "Test error message";

  const [issue] = await dbClient`
    INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, occurrence_count, unique_user_count, resolved_at_version, first_seen_at, last_seen_at)
    VALUES (${appId}, ${projectId}, ${overrides.status ?? "new"}, ${title}, ${overrides.source_module ?? "TestModule"}, ${overrides.is_dev ?? false}, ${overrides.occurrence_count ?? 1}, ${overrides.unique_user_count ?? 1}, ${overrides.resolved_at_version ?? null}, ${now}, ${now})
    RETURNING id
  `;

  await dbClient`
    INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id)
    VALUES (${`fp_${issue.id.slice(0, 8)}`}, ${appId}, ${overrides.is_dev ?? false}, ${issue.id})
  `;

  return issue.id;
}

// Helper to add occurrences to an issue
async function addOccurrence(issueId: string, sessionId: string, userId?: string | null, appVersion?: string | null) {
  await dbClient`
    INSERT INTO issue_occurrences (issue_id, session_id, user_id, app_version, "timestamp")
    VALUES (${issueId}, ${sessionId}, ${userId ?? null}, ${appVersion ?? null}, NOW())
    ON CONFLICT (issue_id, session_id) DO NOTHING
  `;
}

// Helper to ingest events via the API
async function ingestEvents(events: Array<{
  level: string;
  message: string;
  session_id?: string;
  user_id?: string;
  source_module?: string;
  app_version?: string;
  is_dev?: boolean;
  timestamp?: string;
}>) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: {
      bundle_id: TEST_BUNDLE_ID,
      events: events.map((e) => ({
        session_id: e.session_id ?? TEST_SESSION_ID,
        ...e,
      })),
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { accepted: number; rejected: number };
}

describe("Issues API", () => {
  // ── List & Filtering ─────────────────────────────────────────

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

    it("returns all issues for the project", async () => {
      await createTestIssue({ title: "Error A" });
      await createTestIssue({ title: "Error B" });
      await createTestIssue({ title: "Error C" });

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(JSON.parse(res.body).issues).toHaveLength(3);
    });

    it("filters by status", async () => {
      await createTestIssue({ status: "new" });
      await createTestIssue({ status: "resolved" });
      await createTestIssue({ status: "silenced" });

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?status=new`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.issues).toHaveLength(1);
      expect(body.issues[0].status).toBe("new");
    });

    it("filters by app_id", async () => {
      await createTestIssue({ title: "App error" });

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?app_id=${appId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(JSON.parse(res.body).issues).toHaveLength(1);

      // Non-existent app_id
      const res2 = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?app_id=00000000-0000-0000-0000-000000000099`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(JSON.parse(res2.body).issues).toHaveLength(0);
    });

    it("filters by is_dev", async () => {
      await createTestIssue({ is_dev: false });
      await createTestIssue({ is_dev: true });

      const prodRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?is_dev=false`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(JSON.parse(prodRes.body).issues).toHaveLength(1);
      expect(JSON.parse(prodRes.body).issues[0].is_dev).toBe(false);

      const devRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?is_dev=true`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(JSON.parse(devRes.body).issues).toHaveLength(1);
      expect(JSON.parse(devRes.body).issues[0].is_dev).toBe(true);
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

    it("paginates with cursor", async () => {
      await createTestIssue({ title: "Paginate A" });
      await createTestIssue({ title: "Paginate B" });
      await createTestIssue({ title: "Paginate C" });

      const page1 = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?limit=2`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body1 = JSON.parse(page1.body);
      expect(body1.issues.length).toBe(2);
      expect(body1.has_more).toBe(true);
      expect(body1.cursor).toBeTruthy();

      const page2 = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?limit=2&cursor=${body1.cursor}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body2 = JSON.parse(page2.body);
      expect(body2.issues.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Detail ────────────────────────────────────────────────────

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
      expect(body).toHaveProperty("occurrence_cursor");
      expect(body).toHaveProperty("occurrence_has_more");
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

    it("returns 404 for non-existent issue", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/00000000-0000-0000-0000-000000000099`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns occurrences in reverse chronological order", async () => {
      const issueId = await createTestIssue();
      await addOccurrence(issueId, "00000000-0000-0000-0000-aaaaaaaaaaaa", "user1");
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await addOccurrence(issueId, "00000000-0000-0000-0000-bbbbbbbbbbbb", "user2");

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.occurrences.length).toBe(2);
      // Most recent first
      expect(new Date(body.occurrences[0].timestamp).getTime())
        .toBeGreaterThanOrEqual(new Date(body.occurrences[1].timestamp).getTime());
    });
  });

  // ── Status Transitions ────────────────────────────────────────

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

    it("rejects resolve without version (400)", async () => {
      const issueId = await createTestIssue({ status: "new" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "resolved" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/resolved_at_version is required/);
    });

    it("rejects resolve with whitespace-only version (400)", async () => {
      const issueId = await createTestIssue({ status: "new" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "resolved", resolved_at_version: "   " },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/resolved_at_version is required/);
    });

    it("trims whitespace from resolved_at_version", async () => {
      const issueId = await createTestIssue({ status: "new" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "resolved", resolved_at_version: "  1.5.0  " },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).resolved_at_version).toBe("1.5.0");
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

    it("reopens a resolved issue and clears version", async () => {
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

    it("unclaims from in_progress back to new", async () => {
      const issueId = await createTestIssue({ status: "in_progress" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "new" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe("new");
    });

    it("resolves from in_progress", async () => {
      const issueId = await createTestIssue({ status: "in_progress" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "resolved", resolved_at_version: "3.0.0" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe("resolved");
    });

    it("claims a regressed issue", async () => {
      const issueId = await createTestIssue({ status: "regressed" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "in_progress" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe("in_progress");
    });

    it("silences a regressed issue", async () => {
      const issueId = await createTestIssue({ status: "regressed" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "silenced" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe("silenced");
    });

    it("reopens a silenced issue", async () => {
      const issueId = await createTestIssue({ status: "silenced" });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "new" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe("new");
    });

    // Invalid transitions
    it("rejects new → regressed (job-only)", async () => {
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

    it("rejects resolved → in_progress", async () => {
      const issueId = await createTestIssue({ status: "resolved" });
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "in_progress" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects resolved → regressed via API", async () => {
      const issueId = await createTestIssue({ status: "resolved" });
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "regressed" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects missing status field", async () => {
      const issueId = await createTestIssue();
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid status value", async () => {
      const issueId = await createTestIssue();
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "deleted" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for non-existent issue", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/00000000-0000-0000-0000-000000000099`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: "resolved" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Merge ─────────────────────────────────────────────────────

  describe("POST /v1/projects/:projectId/issues/:issueId/merge", () => {
    it("merges source into target — fingerprints combined", async () => {
      const targetId = await createTestIssue({ title: "Target Error" });
      const sourceId = await createTestIssue({ title: "Source Error" });

      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${targetId}/merge`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { source_issue_id: sourceId },
      });
      expect(res.statusCode).toBe(200);
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

    it("merges occurrences and deduplicates by session", async () => {
      const targetId = await createTestIssue({ title: "Target" });
      const sourceId = await createTestIssue({ title: "Source" });
      const sharedSession = "00000000-0000-0000-0000-aaa000000001";

      // Both issues have the same session
      await addOccurrence(targetId, sharedSession, "user1");
      await addOccurrence(sourceId, sharedSession, "user1");
      // Source has an additional unique session
      await addOccurrence(sourceId, "00000000-0000-0000-0000-bbb000000001", "user2");

      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${targetId}/merge`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { source_issue_id: sourceId },
      });
      expect(res.statusCode).toBe(200);

      // Check detail — should have 2 sessions (shared deduplicated, unique moved)
      const detail = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${targetId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(detail.body);
      expect(body.occurrences.length).toBe(2);
      expect(body.occurrence_count).toBe(2);
    });

    it("merges comments from source to target", async () => {
      const targetId = await createTestIssue({ title: "Target" });
      const sourceId = await createTestIssue({ title: "Source" });

      // Add comments to both
      await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${targetId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "Target comment" },
      });
      await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${sourceId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "Source comment" },
      });

      await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${targetId}/merge`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { source_issue_id: sourceId },
      });

      // Detail should have both comments
      const detail = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${targetId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(detail.body);
      expect(body.comments.length).toBe(2);
      const commentBodies = body.comments.map((c: any) => c.body);
      expect(commentBodies).toContain("Target comment");
      expect(commentBodies).toContain("Source comment");
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

    it("rejects missing source_issue_id", async () => {
      const issueId = await createTestIssue();
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/merge`,
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when source does not exist", async () => {
      const targetId = await createTestIssue();
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${targetId}/merge`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { source_issue_id: "00000000-0000-0000-0000-000000000099" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Comments ──────────────────────────────────────────────────

  describe("Comments", () => {
    it("creates and lists comments", async () => {
      const issueId = await createTestIssue();

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
      expect(created.author_name).toBeTruthy();

      const listRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.body).comments).toHaveLength(1);
    });

    it("trims whitespace from comment body", async () => {
      const issueId = await createTestIssue();

      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "  some text  " },
      });
      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).body).toBe("some text");
    });

    it("rejects empty body", async () => {
      const issueId = await createTestIssue();

      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects whitespace-only body", async () => {
      const issueId = await createTestIssue();

      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "   " },
      });
      expect(res.statusCode).toBe(400);
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

    it("soft-deletes comment and excludes from list", async () => {
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

    it("returns 404 for comment on non-existent issue", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/00000000-0000-0000-0000-000000000099/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "test" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("comments appear in issue detail response", async () => {
      const issueId = await createTestIssue();

      await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "First comment" },
      });
      await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/issues/${issueId}/comments`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { body: "Second comment" },
      });

      const detail = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(detail.body);
      expect(body.comments).toHaveLength(2);
      // Chronological order
      expect(body.comments[0].body).toBe("First comment");
      expect(body.comments[1].body).toBe("Second comment");
    });
  });

  // ── Permissions ───────────────────────────────────────────────

  describe("Permissions", () => {
    it("agent key with issues:read can list and view", async () => {
      const agentKey = await createAgentKey(app, token, teamId, ["issues:read"]);
      await createTestIssue();

      const listRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${agentKey}` },
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.body).issues).toHaveLength(1);
    });

    it("agent key without issues:read gets 403", async () => {
      const agentKey = await createAgentKey(app, token, teamId, ["events:read"]);
      await createTestIssue();

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${agentKey}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("agent key with issues:write can update status", async () => {
      const agentKey = await createAgentKey(app, token, teamId, ["issues:read", "issues:write"]);
      const issueId = await createTestIssue();

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${agentKey}` },
        payload: { status: "in_progress" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("agent key without issues:write gets 403 on update", async () => {
      const agentKey = await createAgentKey(app, token, teamId, ["issues:read"]);
      const issueId = await createTestIssue();

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/issues/${issueId}`,
        headers: { Authorization: `Bearer ${agentKey}` },
        payload: { status: "resolved" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Project Alert Frequency ───────────────────────────────────

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

    it("accepts all valid frequency values", async () => {
      for (const freq of ["none", "hourly", "6_hourly", "daily", "weekly"]) {
        const res = await app.inject({
          method: "PATCH",
          url: `/v1/projects/${projectId}`,
          headers: { Authorization: `Bearer ${token}` },
          payload: { issue_alert_frequency: freq },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).effective_issue_alert_frequency).toBe(freq);
      }
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

    it("project detail includes alert frequency", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty("issue_alert_frequency");
      expect(body).toHaveProperty("effective_issue_alert_frequency");
    });
  });

  // ── Issue Scan Job ────────────────────────────────────────────

  describe("Issue scan integration", () => {
    it("creates issues from ingested error events after scan", async () => {
      // Ingest an error event
      const ingestRes = await ingestEvents([
        { level: "error", message: "NullPointerException in UserService", source_module: "UserService" },
      ]);
      expect(ingestRes.accepted).toBe(1);

      // Run the scan job directly
      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      const jobCtx = createJobContext();
      const result = await issueScanHandler(app.notificationDispatcher)(jobCtx, {});
      expect(result.events_processed).toBeGreaterThanOrEqual(1);

      // Verify issue was created
      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.issues.length).toBeGreaterThanOrEqual(1);
      const issue = body.issues.find((i: any) => i.title.includes("NullPointerException"));
      expect(issue).toBeTruthy();
      expect(issue.status).toBe("new");
      expect(issue.occurrence_count).toBeGreaterThanOrEqual(1);
    });

    it("deduplicates same error message into one issue", async () => {
      await ingestEvents([
        { level: "error", message: "Connection refused XYZ", session_id: "00000000-0000-0000-0000-a00000000001" },
        { level: "error", message: "Connection refused XYZ", session_id: "00000000-0000-0000-0000-a00000000002" },
        { level: "error", message: "Connection refused XYZ", session_id: "00000000-0000-0000-0000-a00000000003" },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      const connIssues = body.issues.filter((i: any) => i.title === "Connection refused XYZ");
      expect(connIssues).toHaveLength(1);
      expect(connIssues[0].occurrence_count).toBe(3);
    });

    it("ignores non-error events", async () => {
      // Record issue count before
      const beforeRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const beforeCount = JSON.parse(beforeRes.body).issues.length;

      await ingestEvents([
        { level: "info", message: "App started ABC" },
        { level: "warn", message: "Deprecated API called ABC" },
        { level: "debug", message: "Cache miss ABC" },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const afterRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const afterCount = JSON.parse(afterRes.body).issues.length;
      // No new issues from info/warn/debug events
      expect(afterCount).toBe(beforeCount);
    });

    it("creates separate issues for different error messages", async () => {
      await ingestEvents([
        { level: "error", message: "Timeout exceeded QRS", session_id: "00000000-0000-0000-0000-b00000000001" },
        { level: "error", message: "Permission denied QRS", session_id: "00000000-0000-0000-0000-b00000000002" },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      const timeoutIssues = body.issues.filter((i: any) => i.title.includes("Timeout exceeded QRS"));
      const permIssues = body.issues.filter((i: any) => i.title.includes("Permission denied QRS"));
      expect(timeoutIssues).toHaveLength(1);
      expect(permIssues).toHaveLength(1);
    });

    it("groups errors with variable parts into one issue via normalization", async () => {
      await ingestEvents([
        { level: "error", message: "User 123 not found JKL", session_id: "00000000-0000-0000-0000-c00000000001" },
        { level: "error", message: "User 456 not found JKL", session_id: "00000000-0000-0000-0000-c00000000002" },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      const userNotFoundIssues = body.issues.filter((i: any) => i.title.includes("not found JKL"));
      expect(userNotFoundIssues).toHaveLength(1);
      expect(userNotFoundIssues[0].occurrence_count).toBe(2);
    });

    it("resolved issue stays resolved for same/older app version", async () => {
      const { generateIssueFingerprint } = await import("@owlmetry/shared");
      const message = "Resolved error stays AAAA";
      const fp = await generateIssueFingerprint(message, null);

      // Create a resolved issue with version 2.0.0
      const [issue] = await dbClient`
        INSERT INTO issues (app_id, project_id, status, title, is_dev, resolved_at_version, first_seen_at, last_seen_at, occurrence_count, unique_user_count)
        VALUES (${appId}, ${projectId}, 'resolved', ${message}, false, '2.0.0', NOW(), NOW(), 0, 0)
        RETURNING id
      `;
      await dbClient`
        INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id) VALUES (${fp}, ${appId}, false, ${issue.id})
      `;

      // Ingest error with older version
      await ingestEvents([
        { level: "error", message, app_version: "1.9.0", session_id: "00000000-0000-0000-0000-d00000000001" },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      const result = await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});
      expect(result.events_processed).toBeGreaterThanOrEqual(1);

      // Should still be resolved (not regressed since 1.9.0 < 2.0.0)
      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issue.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.status).toBe("resolved");
      // But the occurrence was still recorded
      expect(body.occurrence_count).toBeGreaterThanOrEqual(1);
    });

    it("silenced issue stays silenced but records occurrence", async () => {
      const { generateIssueFingerprint } = await import("@owlmetry/shared");
      const message = "Silenced error stays BBBB";
      const fp = await generateIssueFingerprint(message, null);

      const [issue] = await dbClient`
        INSERT INTO issues (app_id, project_id, status, title, is_dev, first_seen_at, last_seen_at, occurrence_count, unique_user_count)
        VALUES (${appId}, ${projectId}, 'silenced', ${message}, false, NOW(), NOW(), 0, 0)
        RETURNING id
      `;
      await dbClient`
        INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id) VALUES (${fp}, ${appId}, false, ${issue.id})
      `;

      await ingestEvents([
        { level: "error", message, session_id: "00000000-0000-0000-0000-e00000000001" },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issue.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.status).toBe("silenced");
      expect(body.occurrence_count).toBeGreaterThanOrEqual(1);
    });

    it("regresses a resolved issue when a newer version reports the same error (semver-aware)", async () => {
      // Specifically guards against the lexicographic comparison bug where "1.10.0" < "1.9.0" as strings.
      const { generateIssueFingerprint } = await import("@owlmetry/shared");
      const message = "Crash on launch GHIJ";
      const fp = await generateIssueFingerprint(message, null);

      const [issue] = await dbClient`
        INSERT INTO issues (app_id, project_id, status, title, is_dev, resolved_at_version, first_seen_at, last_seen_at, occurrence_count, unique_user_count)
        VALUES (${appId}, ${projectId}, 'resolved', ${message}, false, '1.9.0', NOW(), NOW(), 0, 0)
        RETURNING id
      `;
      await dbClient`
        INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id) VALUES (${fp}, ${appId}, false, ${issue.id})
      `;

      await ingestEvents([
        { level: "error", message, app_version: "1.10.0", session_id: "00000000-0000-0000-0000-e00000000001" },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issue.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.status).toBe("regressed");
      expect(body.resolved_at_version).toBeNull();
    });

    it("populates first/last_seen_app_version on the issue from occurrences", async () => {
      await ingestEvents([
        { level: "error", message: "Versioned error LMNO", app_version: "1.0.0", session_id: "00000000-0000-0000-0000-e10000000001", timestamp: new Date(Date.now() - 60_000).toISOString() },
        { level: "error", message: "Versioned error LMNO", app_version: "1.2.0", session_id: "00000000-0000-0000-0000-e10000000002", timestamp: new Date(Date.now() - 30_000).toISOString() },
        { level: "error", message: "Versioned error LMNO", app_version: "1.3.0", session_id: "00000000-0000-0000-0000-e10000000003" },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      const issue = body.issues.find((i: any) => i.title === "Versioned error LMNO");
      expect(issue).toBeTruthy();
      expect(issue.first_seen_app_version).toBe("1.0.0");
      expect(issue.last_seen_app_version).toBe("1.3.0");
    });

    // ── Session-burst aliasing ──────────────────────────────────────
    //
    // Errors fired in the same session within BURST_WINDOW_MS (5s) of each
    // other are aliased onto a single issue. The policy is conservative: two
    // pre-existing issues never merge, only newly-seen fingerprints get
    // attached to an existing neighbor in a burst.

    it("burst: aliases co-occurring fingerprints in the same session to one issue", async () => {
      const session = "00000000-0000-0000-0000-b11100000001";
      const base = Date.now() - 60_000;
      await ingestEvents([
        { level: "error", message: "Model file not found BURST1", source_module: "ModelLoader.swift:46", session_id: session, timestamp: new Date(base).toISOString() },
        { level: "error", message: "metric:model-load:fail", source_module: "ModelDocument.swift:73", session_id: session, timestamp: new Date(base + 100).toISOString() },
        { level: "error", message: "model-load-failed BURST1", source_module: "ModelDocument.swift:78", session_id: session, timestamp: new Date(base + 200).toISOString() },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      const ours = body.issues.filter((i: any) =>
        i.title === "Model file not found BURST1" ||
        i.title === "metric:model-load:fail" ||
        i.title === "model-load-failed BURST1"
      );
      expect(ours).toHaveLength(1);
      // Title prefers the non-metric:/step:/track: event
      expect(ours[0].title).toBe("Model file not found BURST1");
      expect(ours[0].fingerprints.length).toBe(3);
      // All three events share a session → one occurrence
      expect(ours[0].occurrence_count).toBe(1);
    });

    it("burst: events >5s apart in the same session create separate issues", async () => {
      const session = "00000000-0000-0000-0000-b22200000001";
      const base = Date.now() - 60_000;
      await ingestEvents([
        { level: "error", message: "Network error BURST2", source_module: "NetA.swift:10", session_id: session, timestamp: new Date(base).toISOString() },
        { level: "error", message: "Cache miss BURST2", source_module: "CacheB.swift:20", session_id: session, timestamp: new Date(base + 6000).toISOString() },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      const ours = body.issues.filter((i: any) =>
        i.title === "Network error BURST2" || i.title === "Cache miss BURST2"
      );
      expect(ours).toHaveLength(2);
      for (const issue of ours) {
        expect(issue.fingerprints.length).toBe(1);
      }
    });

    it("burst: conservative — new fingerprint aliases to a co-occurring existing issue", async () => {
      const { generateIssueFingerprint } = await import("@owlmetry/shared");
      const existingMessage = "Existing issue BURST3";
      const existingModule = "Existing.swift:1";
      const newMessage = "New cooccurring error BURST3";
      const newModule = "NewCo.swift:2";
      const fpExisting = await generateIssueFingerprint(existingMessage, existingModule);

      const [existing] = await dbClient`
        INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, first_seen_at, last_seen_at, occurrence_count, unique_user_count)
        VALUES (${appId}, ${projectId}, 'new', ${existingMessage}, ${existingModule}, false, NOW(), NOW(), 0, 0)
        RETURNING id
      `;
      await dbClient`
        INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id)
        VALUES (${fpExisting}, ${appId}, false, ${existing.id})
      `;

      const session = "00000000-0000-0000-0000-b33300000001";
      const base = Date.now() - 60_000;
      await ingestEvents([
        { level: "error", message: existingMessage, source_module: existingModule, session_id: session, timestamp: new Date(base).toISOString() },
        { level: "error", message: newMessage, source_module: newModule, session_id: session, timestamp: new Date(base + 200).toISOString() },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${existing.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.fingerprints.length).toBe(2);
      expect(body.occurrence_count).toBe(1);

      // No orphan issue for the new message
      const listRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const orphan = JSON.parse(listRes.body).issues.find((i: any) => i.title === newMessage);
      expect(orphan).toBeUndefined();
    });

    it("burst: conservative — two pre-existing issues co-occurring do NOT merge", async () => {
      const { generateIssueFingerprint } = await import("@owlmetry/shared");
      const messageA = "Pre-existing A BURST4";
      const moduleA = "PreA.swift:1";
      const messageB = "Pre-existing B BURST4";
      const moduleB = "PreB.swift:2";
      const fpA = await generateIssueFingerprint(messageA, moduleA);
      const fpB = await generateIssueFingerprint(messageB, moduleB);

      const [issueA] = await dbClient`
        INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, first_seen_at, last_seen_at, occurrence_count, unique_user_count)
        VALUES (${appId}, ${projectId}, 'new', ${messageA}, ${moduleA}, false, NOW(), NOW(), 0, 0)
        RETURNING id
      `;
      const [issueB] = await dbClient`
        INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, first_seen_at, last_seen_at, occurrence_count, unique_user_count)
        VALUES (${appId}, ${projectId}, 'new', ${messageB}, ${moduleB}, false, NOW(), NOW(), 0, 0)
        RETURNING id
      `;
      await dbClient`INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id) VALUES (${fpA}, ${appId}, false, ${issueA.id})`;
      await dbClient`INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id) VALUES (${fpB}, ${appId}, false, ${issueB.id})`;

      const session = "00000000-0000-0000-0000-b44400000001";
      const base = Date.now() - 60_000;
      await ingestEvents([
        { level: "error", message: messageA, source_module: moduleA, session_id: session, timestamp: new Date(base).toISOString() },
        { level: "error", message: messageB, source_module: moduleB, session_id: session, timestamp: new Date(base + 500).toISOString() },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const resA = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issueA.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const bodyA = JSON.parse(resA.body);
      expect(bodyA.fingerprints.length).toBe(1);
      expect(bodyA.occurrence_count).toBe(1);

      const resB = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issueB.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const bodyB = JSON.parse(resB.body);
      expect(bodyB.fingerprints.length).toBe(1);
      expect(bodyB.occurrence_count).toBe(1);
    });

    it("burst: title prefers the first non-specialized message even when a metric:*:fail event fires first", async () => {
      const session = "00000000-0000-0000-0000-b66600000001";
      const base = Date.now() - 60_000;
      // metric:*:fail fires first in time — the non-specialized event lands later.
      // The title preference rule should still pick the non-specialized message.
      await ingestEvents([
        { level: "error", message: "metric:model-load:fail", source_module: "Doc.swift:10", session_id: session, timestamp: new Date(base).toISOString() },
        { level: "error", message: "Recovery failed BURST6", source_module: "Doc.swift:20", session_id: session, timestamp: new Date(base + 500).toISOString() },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const ours = JSON.parse(res.body).issues.filter((i: any) =>
        i.title === "metric:model-load:fail" || i.title === "Recovery failed BURST6"
      );
      expect(ours).toHaveLength(1);
      expect(ours[0].title).toBe("Recovery failed BURST6");
      expect(ours[0].fingerprints.length).toBe(2);
    });

    it("burst: all-specialized burst falls back to the chronologically first event for the title", async () => {
      const session = "00000000-0000-0000-0000-b77700000001";
      const base = Date.now() - 60_000;
      await ingestEvents([
        { level: "error", message: "metric:a-flow:fail", source_module: "A.swift:1", session_id: session, timestamp: new Date(base).toISOString() },
        { level: "error", message: "metric:b-flow:fail", source_module: "B.swift:2", session_id: session, timestamp: new Date(base + 500).toISOString() },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const ours = JSON.parse(res.body).issues.filter((i: any) =>
        i.title === "metric:a-flow:fail" || i.title === "metric:b-flow:fail"
      );
      expect(ours).toHaveLength(1);
      expect(ours[0].title).toBe("metric:a-flow:fail");
      expect(ours[0].fingerprints.length).toBe(2);
    });

    it("burst: multiple non-overlapping bursts in the same session create separate issues", async () => {
      const session = "00000000-0000-0000-0000-b88800000001";
      const base = Date.now() - 60_000;
      await ingestEvents([
        { level: "error", message: "Early error A BURST8", source_module: "A.swift:1", session_id: session, timestamp: new Date(base).toISOString() },
        { level: "error", message: "Early error B BURST8", source_module: "B.swift:2", session_id: session, timestamp: new Date(base + 100).toISOString() },
        // 10s gap — starts a new burst
        { level: "error", message: "Late error C BURST8", source_module: "C.swift:3", session_id: session, timestamp: new Date(base + 10_000).toISOString() },
        { level: "error", message: "Late error D BURST8", source_module: "D.swift:4", session_id: session, timestamp: new Date(base + 10_100).toISOString() },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const ours = JSON.parse(res.body).issues.filter((i: any) => i.title.includes("BURST8"));
      expect(ours).toHaveLength(2);
      // Each burst-issue should carry both of its burst's fingerprints
      for (const issue of ours) {
        expect(issue.fingerprints.length).toBe(2);
      }
    });

    it("burst: regression fires when a resolved issue's fingerprint co-occurs with a new fp at a newer app_version", async () => {
      const { generateIssueFingerprint } = await import("@owlmetry/shared");
      const resolvedMessage = "Pre-resolved error BURST9";
      const resolvedModule = "Resolved.swift:1";
      const newCoMessage = "Burst companion BURST9";
      const newCoModule = "Companion.swift:2";
      const fpResolved = await generateIssueFingerprint(resolvedMessage, resolvedModule);

      const [issue] = await dbClient`
        INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, resolved_at_version, first_seen_at, last_seen_at, occurrence_count, unique_user_count)
        VALUES (${appId}, ${projectId}, 'resolved', ${resolvedMessage}, ${resolvedModule}, false, '1.0.0', NOW(), NOW(), 0, 0)
        RETURNING id
      `;
      await dbClient`
        INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id)
        VALUES (${fpResolved}, ${appId}, false, ${issue.id})
      `;

      const session = "00000000-0000-0000-0000-b99900000001";
      const base = Date.now() - 60_000;
      await ingestEvents([
        { level: "error", message: resolvedMessage, source_module: resolvedModule, app_version: "1.1.0", session_id: session, timestamp: new Date(base).toISOString() },
        { level: "error", message: newCoMessage, source_module: newCoModule, app_version: "1.1.0", session_id: session, timestamp: new Date(base + 200).toISOString() },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${issue.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.status).toBe("regressed");
      expect(body.resolved_at_version).toBeNull();
      // And the new fingerprint aliased onto the same issue
      expect(body.fingerprints.length).toBe(2);
    });

    it("burst: new fingerprint in a burst with two pre-existing issues aliases to the oldest", async () => {
      const { generateIssueFingerprint } = await import("@owlmetry/shared");
      const olderMessage = "Older issue BURST10";
      const olderModule = "Older.swift:1";
      const newerMessage = "Newer issue BURST10";
      const newerModule = "Newer.swift:2";
      const unseenMessage = "Unseen companion BURST10";
      const unseenModule = "Unseen.swift:3";
      const fpOlder = await generateIssueFingerprint(olderMessage, olderModule);
      const fpNewer = await generateIssueFingerprint(newerMessage, newerModule);

      // Create the older issue first (earlier created_at).
      const [olderIssue] = await dbClient`
        INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, first_seen_at, last_seen_at, occurrence_count, unique_user_count, created_at)
        VALUES (${appId}, ${projectId}, 'new', ${olderMessage}, ${olderModule}, false, NOW(), NOW(), 0, 0, NOW() - INTERVAL '1 hour')
        RETURNING id
      `;
      const [newerIssue] = await dbClient`
        INSERT INTO issues (app_id, project_id, status, title, source_module, is_dev, first_seen_at, last_seen_at, occurrence_count, unique_user_count)
        VALUES (${appId}, ${projectId}, 'new', ${newerMessage}, ${newerModule}, false, NOW(), NOW(), 0, 0)
        RETURNING id
      `;
      await dbClient`INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id) VALUES (${fpOlder}, ${appId}, false, ${olderIssue.id})`;
      await dbClient`INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id) VALUES (${fpNewer}, ${appId}, false, ${newerIssue.id})`;

      const session = "00000000-0000-0000-0000-c11100000001";
      const base = Date.now() - 60_000;
      await ingestEvents([
        { level: "error", message: olderMessage, source_module: olderModule, session_id: session, timestamp: new Date(base).toISOString() },
        { level: "error", message: newerMessage, source_module: newerModule, session_id: session, timestamp: new Date(base + 200).toISOString() },
        { level: "error", message: unseenMessage, source_module: unseenModule, session_id: session, timestamp: new Date(base + 400).toISOString() },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      // Older issue gains the unseen fingerprint
      const olderRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${olderIssue.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const olderBody = JSON.parse(olderRes.body);
      expect(olderBody.fingerprints.length).toBe(2);

      // Newer issue stays alone
      const newerRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${newerIssue.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const newerBody = JSON.parse(newerRes.body);
      expect(newerBody.fingerprints.length).toBe(1);

      // No orphan issue created for the unseen message
      const listRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const orphan = JSON.parse(listRes.body).issues.find((i: any) => i.title === unseenMessage);
      expect(orphan).toBeUndefined();
    });

    it("burst: does not cross-alias dev and prod events in the same session", async () => {
      const session = "00000000-0000-0000-0000-b55500000001";
      const base = Date.now() - 60_000;
      await ingestEvents([
        { level: "error", message: "Dev-only error BURST5", source_module: "DevOnly.swift:1", session_id: session, is_dev: true, timestamp: new Date(base).toISOString() },
        { level: "error", message: "Prod-only error BURST5", source_module: "ProdOnly.swift:2", session_id: session, is_dev: false, timestamp: new Date(base + 500).toISOString() },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      const devRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?is_dev=true`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const dev = JSON.parse(devRes.body).issues.filter((i: any) => i.title.includes("BURST5"));
      expect(dev).toHaveLength(1);
      expect(dev[0].title).toBe("Dev-only error BURST5");
      expect(dev[0].fingerprints.length).toBe(1);

      const prodRes = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues?is_dev=false`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const prod = JSON.parse(prodRes.body).issues.filter((i: any) => i.title.includes("BURST5"));
      expect(prod).toHaveLength(1);
      expect(prod[0].title).toBe("Prod-only error BURST5");
      expect(prod[0].fingerprints.length).toBe(1);
    });

    it("merged issue routes new events to surviving issue", async () => {
      const { generateIssueFingerprint } = await import("@owlmetry/shared");
      const messageA = "Surviving issue CCCC";
      const messageB = "Merged away issue DDDD";
      const fpA = await generateIssueFingerprint(messageA, null);
      const fpB = await generateIssueFingerprint(messageB, null);

      // Create target issue with fingerprint A
      const [target] = await dbClient`
        INSERT INTO issues (app_id, project_id, status, title, is_dev, first_seen_at, last_seen_at, occurrence_count, unique_user_count)
        VALUES (${appId}, ${projectId}, 'new', ${messageA}, false, NOW(), NOW(), 0, 0)
        RETURNING id
      `;
      await dbClient`INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id) VALUES (${fpA}, ${appId}, false, ${target.id})`;

      // Simulate a merge: fingerprint B also points to target issue
      await dbClient`INSERT INTO issue_fingerprints (fingerprint, app_id, is_dev, issue_id) VALUES (${fpB}, ${appId}, false, ${target.id})`;

      // Ingest error matching message B (the merged-away fingerprint)
      await ingestEvents([
        { level: "error", message: messageB, session_id: "00000000-0000-0000-0000-f00000000001" },
      ]);

      const { issueScanHandler } = await import("../jobs/issue-scan.js");
      await issueScanHandler(app.notificationDispatcher)(createJobContext(), {});

      // The occurrence should route to the target issue
      const res = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/issues/${target.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(res.body);
      expect(body.occurrence_count).toBeGreaterThanOrEqual(1);
      expect(body.occurrences.some((o: any) => o.session_id === "00000000-0000-0000-0000-f00000000001")).toBe(true);
    });
  });
});

// Helper to create a minimal JobContext for direct job handler testing
function createJobContext() {
  return {
    runId: "test-run-id",
    updateProgress: async () => {},
    isCancelled: () => false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    db: app.db,
    createClient: () => postgres(TEST_DB_URL, { max: 1 }),
    emailService: undefined,
  };
}
