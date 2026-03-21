import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  createUserAndGetToken,
  addTeamMember,
  createAgentKey,
  testEmailService,
  TEST_USER,
  TEST_AGENT_KEY,
  TEST_DB_URL,
} from "./setup.js";
import postgres from "postgres";

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

  it("rejects missing name or slug", async () => {
    const token = await getToken(app);

    const noSlug = await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Test" },
    });
    expect(noSlug.statusCode).toBe(400);

    const noName = await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { slug: "test" },
    });
    expect(noName.statusCode).toBe(400);
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
  it("returns team details with members and pending_invitations", async () => {
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
    expect(body.pending_invitations).toBeDefined();
    expect(body.pending_invitations).toHaveLength(0);
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

  it("rejects empty body", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("member cannot rename team", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    await addTeamMember(teamId, second.userId, "member");

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
    const second = await registerSecondUser();

    await addTeamMember(teamId, second.userId, "admin");

    const { token: adminToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("soft-deletes team and cascades to children", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    // Create a second team so the user has more than one
    await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Backup Team", slug: "backup-team" },
    });
    const { token: freshToken } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${freshToken}` },
    });
    expect(res.statusCode).toBe(200);

    // Team row still exists with deleted_at set
    const client = postgres(TEST_DB_URL, { max: 1 });
    const [team] = await client`SELECT deleted_at FROM teams WHERE id = ${teamId}`;
    expect(team.deleted_at).not.toBeNull();

    // Projects, apps, and api_keys are soft-deleted
    const [proj] = await client`SELECT deleted_at FROM projects WHERE team_id = ${teamId} LIMIT 1`;
    expect(proj.deleted_at).not.toBeNull();
    const [appRow] = await client`SELECT deleted_at FROM apps WHERE team_id = ${teamId} LIMIT 1`;
    expect(appRow.deleted_at).not.toBeNull();
    const activeKeys = await client`SELECT id FROM api_keys WHERE team_id = ${teamId} AND deleted_at IS NULL`;
    expect(activeKeys).toHaveLength(0);

    // team_members are hard-deleted (access revoked immediately)
    const members = await client`SELECT * FROM team_members WHERE team_id = ${teamId}`;
    expect(members).toHaveLength(0);
    await client.end();
  });

  it("soft-deleted team is invisible to authenticated user", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    // Create second team
    await app.inject({
      method: "POST",
      url: "/v1/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Backup Team", slug: "backup-team" },
    });
    const { token: freshToken } = await getTokenAndTeamId(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${freshToken}` },
    });

    // Re-authenticate — deleted team should not appear in memberships
    const { token: afterToken, teams: afterTeams } = await createUserAndGetToken(app, TEST_USER.email);
    expect(afterTeams).toHaveLength(1);
    expect(afterTeams[0].slug).toBe("backup-team");

    // GET the deleted team should 403 (no membership)
    const getRes = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${afterToken}` },
    });
    expect(getRes.statusCode).toBe(403);
  });
});

// ─── Team Invitations ─────────────────────────────────────────────

describe("POST /v1/teams/:teamId/invitations", () => {
  it("owner can invite a user by email", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "newuser@owlmetry.com" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.email).toBe("newuser@owlmetry.com");
    expect(body.role).toBe("member");
    expect(body.invited_by.email).toBe(TEST_USER.email);
    expect(body.expires_at).toBeDefined();

    // Verify email service was called
    expect(testEmailService.lastInvitationEmail).toBe("newuser@owlmetry.com");
    expect(testEmailService.lastInvitationParams?.team_name).toBe("Test Team");
  });

  it("admin can invite a user", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    await addTeamMember(teamId, second.userId, "admin");
    const { token: adminToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: "third@owlmetry.com" },
    });

    expect(res.statusCode).toBe(201);
  });

  it("member cannot invite", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    await addTeamMember(teamId, second.userId, "member");
    const { token: memberToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { email: "third@owlmetry.com" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 409 if user is already a member", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    await addTeamMember(teamId, second.userId, "member");

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "second@owlmetry.com" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("admin cannot invite as owner", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    await addTeamMember(teamId, second.userId, "admin");
    const { token: adminToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: "third@owlmetry.com", role: "owner" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("owner can invite as owner", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "newuser@owlmetry.com", role: "owner" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe("owner");
  });

  it("re-inviting same email regenerates token", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res1 = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "newuser@owlmetry.com" },
    });

    const res2 = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "newuser@owlmetry.com", role: "admin" },
    });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    // Same invitation ID but updated role
    expect(res2.json().id).toBe(res1.json().id);
    expect(res2.json().role).toBe("admin");
  });
});

describe("GET /v1/invites/:token", () => {
  it("returns public invite info", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const createRes = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "newuser@owlmetry.com", role: "admin" },
    });

    // Extract token from the accept URL
    const acceptUrl = testEmailService.lastInvitationParams!.accept_url;
    const inviteToken = new URL(acceptUrl).searchParams.get("token")!;

    const res = await app.inject({
      method: "GET",
      url: `/v1/invites/${inviteToken}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team_name).toBe("Test Team");
    expect(body.role).toBe("admin");
    expect(body.email).toBe("newuser@owlmetry.com");
    expect(body.invited_by_name).toBe(TEST_USER.name);
  });

  it("returns 404 for invalid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/invites/00000000-0000-0000-0000-000000000000",
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 410 for expired invitation", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "expired@owlmetry.com" },
    });

    const acceptUrl = testEmailService.lastInvitationParams!.accept_url;
    const inviteToken = new URL(acceptUrl).searchParams.get("token")!;

    // Expire the invitation via direct DB update
    const client = postgres(TEST_DB_URL, { max: 1 });
    await client`UPDATE team_invitations SET expires_at = NOW() - INTERVAL '1 day' WHERE token = ${inviteToken}`;
    await client.end();

    const res = await app.inject({
      method: "GET",
      url: `/v1/invites/${inviteToken}`,
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().error).toMatch(/expired/i);
  });
});

describe("POST /v1/invites/accept", () => {
  it("accepts an invitation and adds user to team", async () => {
    const { token: ownerToken, teamId } = await getTokenAndTeamId(app);

    // Create invitation for a new user
    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: "newuser@owlmetry.com", role: "admin" },
    });

    const acceptUrl = testEmailService.lastInvitationParams!.accept_url;
    const inviteToken = new URL(acceptUrl).searchParams.get("token")!;

    // Register the new user
    const newUser = await createUserAndGetToken(app, "newuser@owlmetry.com", "New User");

    // Accept the invitation
    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      headers: { authorization: `Bearer ${newUser.token}` },
      payload: { token: inviteToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team_name).toBe("Test Team");
    expect(body.role).toBe("admin");

    // Verify the user is now a member
    const { token: freshToken } = await createUserAndGetToken(app, "newuser@owlmetry.com");
    const teamRes = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${freshToken}` },
    });

    expect(teamRes.statusCode).toBe(200);
    expect(teamRes.json().members).toHaveLength(2);
  });

  it("rejects if email doesn't match", async () => {
    const { token: ownerToken, teamId } = await getTokenAndTeamId(app);

    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: "specific@owlmetry.com" },
    });

    const acceptUrl = testEmailService.lastInvitationParams!.accept_url;
    const inviteToken = new URL(acceptUrl).searchParams.get("token")!;

    // Different user tries to accept
    const wrongUser = await createUserAndGetToken(app, "wrong@owlmetry.com", "Wrong User");

    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      headers: { authorization: `Bearer ${wrongUser.token}` },
      payload: { token: inviteToken },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("specific@owlmetry.com");
  });

  it("rejects expired invitation", async () => {
    const { token: ownerToken, teamId } = await getTokenAndTeamId(app);

    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: "expired@owlmetry.com" },
    });

    const acceptUrl = testEmailService.lastInvitationParams!.accept_url;
    const inviteToken = new URL(acceptUrl).searchParams.get("token")!;

    // Expire the invitation
    const client = postgres(TEST_DB_URL, { max: 1 });
    await client`UPDATE team_invitations SET expires_at = NOW() - INTERVAL '1 day' WHERE token = ${inviteToken}`;
    await client.end();

    const newUser = await createUserAndGetToken(app, "expired@owlmetry.com", "Expired User");

    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      headers: { authorization: `Bearer ${newUser.token}` },
      payload: { token: inviteToken },
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().error).toMatch(/expired/i);
  });

  it("rejects already-accepted invitation", async () => {
    const { token: ownerToken, teamId } = await getTokenAndTeamId(app);

    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: "accepted@owlmetry.com" },
    });

    const acceptUrl = testEmailService.lastInvitationParams!.accept_url;
    const inviteToken = new URL(acceptUrl).searchParams.get("token")!;

    const newUser = await createUserAndGetToken(app, "accepted@owlmetry.com", "Accepted User");

    // Accept the invitation the first time
    await app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      headers: { authorization: `Bearer ${newUser.token}` },
      payload: { token: inviteToken },
    });

    // Re-auth and try to accept again
    const { token: freshToken } = await createUserAndGetToken(app, "accepted@owlmetry.com");

    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      headers: { authorization: `Bearer ${freshToken}` },
      payload: { token: inviteToken },
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().error).toMatch(/already been accepted/i);
  });

  it("succeeds when user is already a team member (race condition)", async () => {
    const { token: ownerToken, teamId } = await getTokenAndTeamId(app);

    await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: "racer@owlmetry.com" },
    });

    const acceptUrl = testEmailService.lastInvitationParams!.accept_url;
    const inviteToken = new URL(acceptUrl).searchParams.get("token")!;

    // Register user and add them directly as a member (simulating race condition)
    const newUser = await createUserAndGetToken(app, "racer@owlmetry.com", "Racer");
    await addTeamMember(teamId, newUser.userId, "member");

    // Re-auth to pick up membership
    const { token: freshToken } = await createUserAndGetToken(app, "racer@owlmetry.com");

    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      headers: { authorization: `Bearer ${freshToken}` },
      payload: { token: inviteToken },
    });

    // Should succeed — catches PG unique violation and marks invite accepted
    expect(res.statusCode).toBe(200);
    expect(res.json().team_name).toBe("Test Team");

    // Verify invitation is marked as accepted
    const client = postgres(TEST_DB_URL, { max: 1 });
    const [inv] = await client`SELECT accepted_at FROM team_invitations WHERE token = ${inviteToken}`;
    expect(inv.accepted_at).not.toBeNull();
    await client.end();
  });
});

describe("DELETE /v1/teams/:teamId/invitations/:invitationId", () => {
  it("admin can revoke an invitation", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const createRes = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/invitations`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: "newuser@owlmetry.com" },
    });

    const invitationId = createRes.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}/invitations/${invitationId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });
});

// ─── Member Management ─────────────────────────────────────────────

describe("PATCH /v1/teams/:teamId/members/:userId", () => {
  it("owner can change member to admin", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();

    await addTeamMember(teamId, second.userId, "member");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}/members/${second.userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: "admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("admin");
  });

  it("rejects invalid role in member role change", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "member");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}/members/${second.userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: "superadmin" },
    });

    expect(res.statusCode).toBe(400);
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
    const second = await registerSecondUser();

    await addTeamMember(teamId, second.userId, "admin");

    // Register third user and add as member
    const third = await createUserAndGetToken(app, "third@owlmetry.com", "Third User");
    await addTeamMember(teamId, third.userId, "member");

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
    await addTeamMember(teamId, second.userId, "owner");

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

    await addTeamMember(teamId, second.userId, "member");

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
    const second = await registerSecondUser();

    await addTeamMember(teamId, second.userId, "admin");

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

    await addTeamMember(teamId, second.userId, "member");

    const { token: memberToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}/members/${second.userId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(true);
  });

  it("member cannot remove another member", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "member");

    const third = await createUserAndGetToken(app, "third@owlmetry.com", "Third User");
    await addTeamMember(teamId, third.userId, "member");

    const { token: memberToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}/members/${third.userId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(403);
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

// ─── Agent Key Revocation on Member Removal ─────────────────────────

/** Create an agent key via the API, attributed to the user whose token is provided. Returns the key ID. */
async function createAgentKeyForUser(token: string, teamId: string, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/keys",
    headers: { authorization: `Bearer ${token}` },
    payload: { name, key_type: "agent", team_id: teamId },
  });
  return res.json().api_key.id;
}

/** Create a client key via the API, attributed to the user whose token is provided. Returns the key ID. */
async function createClientKeyForUser(token: string, appId: string, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/keys",
    headers: { authorization: `Bearer ${token}` },
    payload: { name, key_type: "client", app_id: appId },
  });
  return res.json().api_key.id;
}

/** Check if an API key is soft-deleted. */
async function isKeyDeleted(keyId: string): Promise<boolean> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  const [row] = await client`SELECT deleted_at FROM api_keys WHERE id = ${keyId}`;
  await client.end();
  return row.deleted_at !== null;
}

describe("GET /v1/teams/:teamId/members/:userId/agent-keys", () => {
  it("returns agent keys created by the member", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "admin");

    // Create key as the second user (needs admin+ to create keys)
    const { token: secondToken } = await createUserAndGetToken(app, "second@owlmetry.com");
    const keyId = await createAgentKeyForUser(secondToken, teamId, "Second Agent");

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/members/${second.userId}/agent-keys`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].id).toBe(keyId);
    expect(body.keys[0].name).toBe("Second Agent");
  });

  it("excludes deleted keys and client keys", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "admin");

    const { token: secondToken } = await createUserAndGetToken(app, "second@owlmetry.com");
    await createAgentKeyForUser(secondToken, teamId, "Active Agent");
    await createClientKeyForUser(secondToken, testData.appId, "Client Key");

    // Soft-delete one agent key
    const deletedId = await createAgentKeyForUser(secondToken, teamId, "Deleted Agent");
    const client = postgres(TEST_DB_URL, { max: 1 });
    await client`UPDATE api_keys SET deleted_at = NOW() WHERE id = ${deletedId}`;
    await client.end();

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/members/${second.userId}/agent-keys`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().keys).toHaveLength(1);
    expect(res.json().keys[0].name).toBe("Active Agent");
  });

  it("allows self-access", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "admin");

    const { token: secondToken } = await createUserAndGetToken(app, "second@owlmetry.com");
    await createAgentKeyForUser(secondToken, teamId, "My Agent");

    // Re-auth and demote to member to prove self-access works even as member
    await app.inject({
      method: "PATCH",
      url: `/v1/teams/${teamId}/members/${second.userId}`,
      headers: { authorization: `Bearer ${(await getTokenAndTeamId(app)).token}` },
      payload: { role: "member" },
    });
    const { token: memberToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/members/${second.userId}/agent-keys`,
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().keys).toHaveLength(1);
  });
});

describe("DELETE /v1/teams/:teamId/members/:userId with revoke_agent_keys", () => {
  it("does not revoke agent keys without the flag", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "admin");

    const { token: secondToken } = await createUserAndGetToken(app, "second@owlmetry.com");
    const keyId = await createAgentKeyForUser(secondToken, teamId, "Agent Key");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}/members/${second.userId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(true);
    expect(res.json().revoked_agent_keys).toBe(0);
    expect(await isKeyDeleted(keyId)).toBe(false);
  });

  it("revokes agent keys with revoke_agent_keys=true", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "admin");

    const { token: secondToken } = await createUserAndGetToken(app, "second@owlmetry.com");
    const agentKeyId = await createAgentKeyForUser(secondToken, teamId, "Agent Key");
    const clientKeyId = await createClientKeyForUser(secondToken, testData.appId, "Client Key");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}/members/${second.userId}?revoke_agent_keys=true`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(true);
    expect(res.json().revoked_agent_keys).toBe(1);
    expect(await isKeyDeleted(agentKeyId)).toBe(true);
    expect(await isKeyDeleted(clientKeyId)).toBe(false);
  });

  it("self-leave with revoke_agent_keys=true revokes own agent keys", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "admin");

    const { token: secondToken } = await createUserAndGetToken(app, "second@owlmetry.com");
    const keyId = await createAgentKeyForUser(secondToken, teamId, "Self Agent");

    // Re-auth to pick up membership
    const { token: freshToken } = await createUserAndGetToken(app, "second@owlmetry.com");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}/members/${second.userId}?revoke_agent_keys=true`,
      headers: { authorization: `Bearer ${freshToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(true);
    expect(res.json().revoked_agent_keys).toBe(1);
    expect(await isKeyDeleted(keyId)).toBe(true);
  });
});

// ─── Role Enforcement on Existing Routes ────────────────────────────

describe("Role enforcement on existing routes", () => {
  async function addMemberAndGetToken(
    teamId: string,
    role: "member" | "admin"
  ) {
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, role);
    const { token } = await createUserAndGetToken(app, "second@owlmetry.com");
    return token;
  }

  it("member cannot create project", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(teamId, "member");

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { team_id: teamId, name: "New Project", slug: "new-project" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("admin can create project", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const adminToken = await addMemberAndGetToken(teamId, "admin");

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { team_id: teamId, name: "New Project", slug: "new-project" },
    });

    expect(res.statusCode).toBe(201);
  });

  it("member can read projects", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(teamId, "member");

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects.length).toBeGreaterThanOrEqual(1);
  });

  it("member cannot delete app", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(teamId, "member");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("member cannot create API key", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(teamId, "member");

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { name: "Test Key", key_type: "agent", team_id: teamId },
    });

    expect(res.statusCode).toBe(403);
  });

  it("member can read API keys", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(teamId, "member");

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(200);
  });
});

// ─── API Key Rejection on Team and Invitation Routes ─────────────────

describe("API key rejection on team and invitation routes", () => {
  it("rejects API key on all team management routes", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const agentKey = await createAgentKey(app, token, teamId, [
      "events:read", "apps:read", "apps:write", "projects:read", "projects:write",
      "metrics:read", "metrics:write", "funnels:read", "funnels:write", "audit_logs:read",
    ]);

    const routes = [
      { method: "POST" as const, url: "/v1/teams", payload: { name: "Test", slug: "test" } },
      { method: "PATCH" as const, url: `/v1/teams/${teamId}`, payload: { name: "New" } },
      { method: "DELETE" as const, url: `/v1/teams/${teamId}` },
      { method: "GET" as const, url: `/v1/teams/${teamId}/members/${testData.userId}/agent-keys` },
      { method: "PATCH" as const, url: `/v1/teams/${teamId}/members/${testData.userId}`, payload: { role: "admin" } },
      { method: "DELETE" as const, url: `/v1/teams/${teamId}/members/${testData.userId}` },
    ];

    for (const route of routes) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: `Bearer ${agentKey}` },
        payload: "payload" in route ? route.payload : undefined,
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("rejects API key on invitation routes", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const agentKey = await createAgentKey(app, token, teamId, [
      "events:read", "apps:read", "apps:write", "projects:read", "projects:write",
      "metrics:read", "metrics:write", "funnels:read", "funnels:write", "audit_logs:read",
    ]);

    const routes = [
      { method: "POST" as const, url: `/v1/teams/${teamId}/invitations`, payload: { email: "test@owlmetry.com" } },
      { method: "POST" as const, url: "/v1/invites/accept", payload: { token: "00000000-0000-0000-0000-000000000000" } },
      { method: "DELETE" as const, url: `/v1/teams/${teamId}/invitations/00000000-0000-0000-0000-000000000000` },
    ];

    for (const route of routes) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: `Bearer ${agentKey}` },
        payload: route.payload,
      });
      expect(res.statusCode).toBe(403);
    }
  });
});
