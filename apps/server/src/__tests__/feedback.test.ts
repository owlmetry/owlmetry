import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createAgentKey,
  createUserAndGetToken,
  addTeamMember,
  TEST_CLIENT_KEY,
  TEST_BUNDLE_ID,
} from "./setup.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || "postgresql://localhost:5432/owlmetry_test";

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

async function ingestFeedback(overrides: {
  message?: string;
  submitter_name?: string | null;
  submitter_email?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  is_dev?: boolean;
} = {}): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/feedback",
    headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: {
      bundle_id: TEST_BUNDLE_ID,
      message: overrides.message ?? "Something happened",
      ...(overrides.submitter_name !== undefined ? { submitter_name: overrides.submitter_name } : {}),
      ...(overrides.submitter_email !== undefined ? { submitter_email: overrides.submitter_email } : {}),
      ...(overrides.session_id !== undefined ? { session_id: overrides.session_id } : {}),
      ...(overrides.user_id !== undefined ? { user_id: overrides.user_id } : {}),
      ...(overrides.is_dev !== undefined ? { is_dev: overrides.is_dev } : {}),
    },
  });
  if (res.statusCode !== 201) throw new Error(`ingest failed: ${res.statusCode} ${res.body}`);
  return res.json().id;
}

describe("GET /v1/projects/:projectId/feedback", () => {
  it("lists feedback sorted newest first", async () => {
    const id1 = await ingestFeedback({ message: "first" });
    await new Promise((r) => setTimeout(r, 10));
    const id2 = await ingestFeedback({ message: "second" });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.feedback).toHaveLength(2);
    expect(body.feedback[0].id).toBe(id2);
    expect(body.feedback[1].id).toBe(id1);
    expect(body.has_more).toBe(false);
    expect(body.feedback[0].app_name).toBe("Test App");
  });

  it("filters by status", async () => {
    const id1 = await ingestFeedback({ message: "one" });
    await ingestFeedback({ message: "two" });

    // Mark id1 as addressed
    await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/feedback/${id1}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { status: "addressed" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback?status=addressed`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.feedback).toHaveLength(1);
    expect(body.feedback[0].id).toBe(id1);
  });

  it("paginates via cursor", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await ingestFeedback({ message: `msg ${i}` }));
      await new Promise((r) => setTimeout(r, 5));
    }

    const first = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback?limit=2`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const firstBody = first.json();
    expect(firstBody.feedback).toHaveLength(2);
    expect(firstBody.has_more).toBe(true);
    expect(firstBody.cursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback?limit=2&cursor=${encodeURIComponent(firstBody.cursor)}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const secondBody = second.json();
    expect(secondBody.feedback).toHaveLength(1);
    expect(secondBody.has_more).toBe(false);
  });

  it("excludes soft-deleted rows", async () => {
    const id = await ingestFeedback({ message: "to delete" });
    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/feedback/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.json().feedback).toHaveLength(0);
  });

  it("respects data_mode default (production only)", async () => {
    await ingestFeedback({ message: "prod" });
    await ingestFeedback({ message: "dev", is_dev: true });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = res.json();
    expect(body.feedback).toHaveLength(1);
    expect(body.feedback[0].message).toBe("prod");
  });

  it("agent key without feedback:read gets 403", async () => {
    const readOnlyAgent = await createAgentKey(app, token, teamId, ["events:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback`,
      headers: { Authorization: `Bearer ${readOnlyAgent}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("agent key with feedback:read gets list", async () => {
    await ingestFeedback({ message: "one" });
    const agentKey = await createAgentKey(app, token, teamId, ["feedback:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback`,
      headers: { Authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().feedback).toHaveLength(1);
  });
});

describe("GET /v1/projects/:projectId/feedback/:feedbackId", () => {
  it("returns detail with empty comments array", async () => {
    const id = await ingestFeedback({
      message: "detail test",
      submitter_name: "A",
      submitter_email: "a@example.com",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.submitter_name).toBe("A");
    expect(body.submitter_email).toBe("a@example.com");
    expect(body.comments).toEqual([]);
  });

  it("returns 404 for non-existent feedback", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback/00000000-0000-0000-0000-000000000000`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("excludes soft-deleted comments from the detail response", async () => {
    const id = await ingestFeedback({ message: "with comments" });
    const c1 = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/feedback/${id}/comments`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "first note" },
    });
    const commentId = c1.json().id;

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/feedback/${id}/comments/${commentId}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/feedback/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.json().comments).toHaveLength(0);
  });
});

describe("PATCH /v1/projects/:projectId/feedback/:feedbackId", () => {
  it("updates status and writes audit log", async () => {
    const id = await ingestFeedback({ message: "status change" });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/feedback/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { status: "in_review" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("in_review");

    // Give the fire-and-forget audit writer a tick to settle
    await new Promise((r) => setTimeout(r, 50));
    const auditRows = await dbClient`
      SELECT * FROM audit_logs
      WHERE resource_type = 'feedback' AND resource_id = ${id}
    `;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("update");
  });

  it("supports the full status lifecycle", async () => {
    const id = await ingestFeedback({ message: "all statuses" });
    for (const status of ["in_review", "addressed", "dismissed", "new"]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${projectId}/feedback/${id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(status);
    }
  });

  it("rejects invalid status", async () => {
    const id = await ingestFeedback({ message: "bad status" });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/feedback/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { status: "exploded" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("agent key without feedback:write gets 403", async () => {
    const id = await ingestFeedback({ message: "hi" });
    const readOnlyAgent = await createAgentKey(app, token, teamId, ["feedback:read"]);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/feedback/${id}`,
      headers: { Authorization: `Bearer ${readOnlyAgent}` },
      payload: { status: "addressed" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/projects/:projectId/feedback/:feedbackId", () => {
  it("user can soft-delete", async () => {
    const id = await ingestFeedback({ message: "bye" });
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/feedback/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    const rows = await dbClient`SELECT deleted_at FROM feedback WHERE id = ${id}`;
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("agent key (even with feedback:write) gets 403 (user-only)", async () => {
    const id = await ingestFeedback({ message: "nope" });
    const agentKey = await createAgentKey(app, token, teamId, [
      "feedback:read",
      "feedback:write",
    ]);
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/feedback/${id}`,
      headers: { Authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("comments", () => {
  it("user creates a comment; author_type=user, author_name from users.name", async () => {
    const id = await ingestFeedback({ message: "commentable" });
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/feedback/${id}/comments`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "  investigating  " },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.author_type).toBe("user");
    expect(body.author_name).toBe("Test User");
    expect(body.body).toBe("investigating");
  });

  it("agent creates a comment; author_type=agent, author_name from api_keys.name", async () => {
    const id = await ingestFeedback({ message: "agent comment" });
    const agentKey = await createAgentKey(app, token, teamId, [
      "feedback:read",
      "feedback:write",
    ]);
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/feedback/${id}/comments`,
      headers: { Authorization: `Bearer ${agentKey}` },
      payload: { body: "robo-note" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().author_type).toBe("agent");
    expect(res.json().author_name).toBe("Custom Agent Key");
  });

  it("rejects blank comment body", async () => {
    const id = await ingestFeedback({ message: "x" });
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/feedback/${id}/comments`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("only the author can edit their comment", async () => {
    const id = await ingestFeedback({ message: "x" });
    const c = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/feedback/${id}/comments`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "mine" },
    });
    const commentId = c.json().id;

    const otherUser = await createUserAndGetToken(app, "other@example.com", "Other");
    await addTeamMember(teamId, otherUser.userId, "member");

    const edit = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/feedback/${id}/comments/${commentId}`,
      headers: { Authorization: `Bearer ${otherUser.token}` },
      payload: { body: "stolen" },
    });
    expect(edit.statusCode).toBe(403);
  });

  it("admin can delete any comment; member cannot delete someone else's", async () => {
    const id = await ingestFeedback({ message: "x" });
    const c = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/feedback/${id}/comments`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "one" },
    });
    const commentId = c.json().id;

    // Member cannot delete another user's comment
    const member = await createUserAndGetToken(app, "member@example.com", "Mem");
    await addTeamMember(teamId, member.userId, "member");
    const memberDel = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/feedback/${id}/comments/${commentId}`,
      headers: { Authorization: `Bearer ${member.token}` },
    });
    expect(memberDel.statusCode).toBe(403);

    // Admin on this team can delete
    const admin = await createUserAndGetToken(app, "admin@example.com", "Adm");
    await addTeamMember(teamId, admin.userId, "admin");
    const adminDel = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/feedback/${id}/comments/${commentId}`,
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(adminDel.statusCode).toBe(200);
  });
});

describe("GET /v1/feedback (team-wide)", () => {
  it("lists feedback across all projects the user has access to", async () => {
    await ingestFeedback({ message: "in project A" });
    const agentKey = await createAgentKey(app, token, teamId, ["feedback:read"]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/feedback`,
      headers: { Authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.feedback.length).toBeGreaterThanOrEqual(1);
    expect(body.feedback[0].project_name).toBe("Test Project");
  });

  it("respects project_id filter", async () => {
    await ingestFeedback({ message: "scoped" });
    const res = await app.inject({
      method: "GET",
      url: `/v1/feedback?project_id=${projectId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().feedback.every((f: any) => f.project_id === projectId)).toBe(true);
  });

  it("returns empty when team_id is not accessible", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/feedback?team_id=00000000-0000-0000-0000-000000000000`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().feedback).toHaveLength(0);
  });

  it("a user outside the team cannot see feedback in that team", async () => {
    await ingestFeedback({ message: "private" });
    const outsider = await createUserAndGetToken(app, "outsider@example.com", "Out");
    const res = await app.inject({
      method: "GET",
      url: `/v1/feedback`,
      headers: { Authorization: `Bearer ${outsider.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().feedback).toHaveLength(0);
  });
});
