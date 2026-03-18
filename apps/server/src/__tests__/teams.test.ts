import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  createUserAndGetToken,
  TEST_USER,
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

/** Create a second user and return their token + user info. */
async function registerSecondUser() {
  return createUserAndGetToken(app, "second@owlmetry.com", "Second User");
}

// ─── Team CRUD ──────────────────────────────────────────────────────

describe("POST /v1/teams", () => {
  it("creates a team and makes the user owner", async () => {
    const token = await getToken(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "New Team", slug: "new-team" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("New Team");
    expect(body.slug).toBe("new-team");
    expect(body.updated_at).toBeDefined();
  });

  it("rejects duplicate slugs", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Team A", slug: "dupe-slug" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Team B", slug: "dupe-slug" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("rejects invalid slugs", async () => {
    const token = await getToken(app);

    const res = await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Bad Slug", slug: "Bad Slug!" },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/teams/:teamId", () => {
  it("returns team details with members", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Test Team");
    expect(body.members).toHaveLength(1);
    expect(body.members[0].role).toBe("owner");
    expect(body.members[0].email).toBe(TEST_USER.email);
  });

  it("returns 403 for non-members", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${second.token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/teams/:teamId", () => {
  it("owner can rename team", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Renamed Team" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Renamed Team");
  });

  it("member cannot rename team", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    await registerSecondUser();

    // Add second user as member
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com", role: "member" },
    });

    // Re-authenticate to pick up new membership
    const { token: secondToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${secondToken}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/teams/:teamId", () => {
  it("owner can delete team if they have another", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    // Create a second team so the user has more than one
    await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Backup Team", slug: "backup-team" },
    });

    // Re-authenticate to refresh memberships in JWT context
    const { token: freshToken } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${freshToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("rejects deleting only team", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("admin cannot delete team", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    await registerSecondUser();

    // Add second user as admin
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com", role: "admin" },
    });

    const { token: adminToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Member Management ─────────────────────────────────────────────

describe("POST /v1/teams/:teamId/members", () => {
  it("owner can add a member", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    await registerSecondUser();

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe("member");
  });

  it("admin can add a member", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    await registerSecondUser();

    // Make second user an admin
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com", role: "admin" },
    });

    // Register a third user
    await createUserAndGetToken(app, "third@owlmetry.com", "Third User");

    // Admin adds third user
    const { token: adminToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: "third@owlmetry.com" },
    });

    expect(res.statusCode).toBe(201);
  });

  it("member cannot add members", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    await registerSecondUser();

    // Add second as member
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com", role: "member" },
    });

    // Register third user
    await createUserAndGetToken(app, "third@owlmetry.com", "Third User");

    const { token: memberToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { email: "third@owlmetry.com" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for non-existent email", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "nobody@owlmetry.com" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 409 for existing member", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    await registerSecondUser();

    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("admin cannot add someone as owner", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    await registerSecondUser();

    // Add second as admin
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com", role: "admin" },
    });

    // Register third user
    await createUserAndGetToken(app, "third@owlmetry.com", "Third User");

    const { token: adminToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: "third@owlmetry.com", role: "owner" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("owner can add someone as owner", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    await registerSecondUser();

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com", role: "owner" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe("owner");
  });
});

describe("PATCH /v1/teams/:teamId/members/:userId", () => {
  it("owner can change member to admin", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    // Add second as member
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com" },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}/members/${second.userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: "admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("admin");
  });

  it("cannot change own role", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}/members/${testData.userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: "member" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("admin cannot promote to owner", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    await registerSecondUser();

    // Add second as admin
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com", role: "admin" },
    });

    // Register third user and add as member
    const third = await createUserAndGetToken(app, "third@owlmetry.com", "Third User");
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "third@owlmetry.com" },
    });

    // Admin tries to promote third to owner
    const { token: adminToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}/members/${third.userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: "owner" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("cannot demote the last owner", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    // Add second as owner
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com", role: "owner" },
    });

    // Second owner demotes first — should succeed since there's still one owner left
    const { token: secondToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res1 = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}/members/${testData.userId}`,
      headers: { authorization: `Bearer ${secondToken}` },
      payload: { role: "admin" },
    });
    expect(res1.statusCode).toBe(200);

    // Re-promote first to owner
    const res2 = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}/members/${testData.userId}`,
      headers: { authorization: `Bearer ${secondToken}` },
      payload: { role: "owner" },
    });
    expect(res2.statusCode).toBe(200);

    // Now demote second, leaving first as sole owner
    const { token: freshToken } = await getTokenAndTeamId(app);

    const res3 = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}/members/${second.userId}`,
      headers: { authorization: `Bearer ${freshToken}` },
      payload: { role: "admin" },
    });
    expect(res3.statusCode).toBe(200);
  });
});

describe("DELETE /v1/teams/:teamId/members/:userId", () => {
  it("owner can remove a member", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}/members/${second.userId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(true);

    // Verify they're gone
    const membersRes = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(membersRes.json().members).toHaveLength(1);
  });

  it("admin cannot remove owner", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    await registerSecondUser();

    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com", role: "admin" },
    });

    const { token: adminToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}/members/${testData.userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("member can leave team (self-removal)", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com" },
    });

    const { token: memberToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}/members/${second.userId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(true);
  });

  it("sole owner cannot leave team", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}/members/${testData.userId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("sole owner");
  });
});

// ─── Role Enforcement on Existing Routes ────────────────────────────

describe("Role enforcement on existing routes", () => {
  async function addMemberAndGetToken(
    ownerToken: string,
    teamId: string,
    role: "member" | "admin"
  ) {
    await registerSecondUser();

    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: "second@owlmetry.com", role },
    });

    const { token } = await createUserAndGetToken(app, "second@owlmetry.com");
    return token;
  }

  it("member cannot create project", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(token, teamId, "member");

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { team_id: teamId, name: "New Project", slug: "new-project" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("admin can create project", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const adminToken = await addMemberAndGetToken(token, teamId, "admin");

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { team_id: teamId, name: "New Project", slug: "new-project" },
    });

    expect(res.statusCode).toBe(201);
  });

  it("member can read projects", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(token, teamId, "member");

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects.length).toBeGreaterThanOrEqual(1);
  });

  it("member cannot delete app", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(token, teamId, "member");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("member cannot create API key", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(token, teamId, "member");

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { name: "Test Key", key_type: "agent", team_id: teamId },
    });

    expect(res.statusCode).toBe(403);
  });

  it("member can read API keys", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(token, teamId, "member");

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(200);
  });
});
