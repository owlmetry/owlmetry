import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createAgentKey,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let dbClient: postgres.Sql;
let token: string;
let teamId: string;
let userId: string;

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
  const [owner] = await dbClient`SELECT id FROM users WHERE email = 'test@owlmetry.com'`;
  userId = owner.id;
});

async function seedNotification(opts: { type?: string; read?: boolean; title?: string } = {}) {
  const [row] = await dbClient`
    INSERT INTO notifications (user_id, team_id, type, title, body, link, data, read_at)
    VALUES (
      ${userId}, ${teamId}, ${opts.type ?? "feedback.new"},
      ${opts.title ?? "Test"}, 'body', '/dashboard/feedback/x', '{}'::jsonb,
      ${opts.read ? new Date() : null}
    )
    RETURNING id
  `;
  return row.id as string;
}

describe("GET /v1/notifications", () => {
  it("lists notifications for the authenticated user", async () => {
    await seedNotification({ title: "First" });
    await seedNotification({ title: "Second" });
    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().notifications).toHaveLength(2);
  });

  it("filters by read_state", async () => {
    await seedNotification({ read: true });
    await seedNotification({ read: false });
    const unread = await app.inject({
      method: "GET",
      url: "/v1/notifications?read_state=unread",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(unread.json().notifications).toHaveLength(1);
    expect(unread.json().notifications[0].read_at).toBeNull();
  });

  it("filters by type", async () => {
    await seedNotification({ type: "feedback.new" });
    await seedNotification({ type: "issue.digest" });
    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications?type=feedback.new",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.json().notifications).toHaveLength(1);
    expect(res.json().notifications[0].type).toBe("feedback.new");
  });

  it("agent key is rejected", async () => {
    const agentKey = await createAgentKey(app, token, teamId, ["events:read"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: { Authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notifications/unread-count", () => {
  it("returns unread count excluding read + deleted", async () => {
    await seedNotification({ read: false });
    await seedNotification({ read: false });
    await seedNotification({ read: true });
    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications/unread-count",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.json().count).toBe(2);
  });
});

describe("PATCH /v1/notifications/:id", () => {
  it("marks a notification read", async () => {
    const id = await seedNotification({ read: false });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/notifications/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { read: true },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await dbClient`SELECT read_at FROM notifications WHERE id = ${id}`;
    expect(row.read_at).not.toBeNull();
  });
});

describe("POST /v1/notifications/mark-all-read", () => {
  it("flips read_at on every unread notification", async () => {
    await seedNotification({ read: false });
    await seedNotification({ read: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/mark-all-read",
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const rows = await dbClient`SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL AND user_id = ${userId}`;
    expect(rows[0].n).toBe(0);
  });
});

describe("DELETE /v1/notifications/:id", () => {
  it("soft-deletes the row", async () => {
    const id = await seedNotification();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/notifications/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await dbClient`SELECT deleted_at FROM notifications WHERE id = ${id}`;
    expect(row.deleted_at).not.toBeNull();
  });
});
