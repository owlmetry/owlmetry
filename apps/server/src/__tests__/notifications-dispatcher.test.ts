import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createUserAndGetToken,
  addTeamMember,
  testPushDeliveries,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let dbClient: postgres.Sql;
let teamId: string;
let ownerUserId: string;

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
  teamId = result.teamId;
  // Resolve owner user ID for ownership checks.
  const [owner] = await dbClient`SELECT id FROM users WHERE email = 'test@owlmetry.com'`;
  ownerUserId = owner.id;
});

async function setUserPreference(userId: string, prefs: Record<string, unknown>) {
  await dbClient`UPDATE users SET preferences = ${JSON.stringify(prefs)}::jsonb WHERE id = ${userId}`;
}

async function registerDevice(userId: string, token: string) {
  await dbClient`
    INSERT INTO user_devices (user_id, channel, token, environment)
    VALUES (${userId}, 'ios_push', ${token}, 'production')
  `;
}

describe("NotificationDispatcher", () => {
  it("creates one inbox row + per-channel deliveries for each user", async () => {
    const u2 = await createUserAndGetToken(app, "member2@owlmetry.com");
    await addTeamMember(teamId, u2.userId, "member");
    await registerDevice(ownerUserId, "device-owner-1");
    await registerDevice(u2.userId, "device-member-1");

    const result = await app.notificationDispatcher.enqueue({
      type: "feedback.new",
      userIds: [ownerUserId, u2.userId],
      teamId,
      payload: { title: "New feedback", body: "Hello", link: "/dashboard/feedback/abc" },
    });

    expect(result.notificationIds).toHaveLength(2);

    const inbox = await dbClient`SELECT user_id, type, title FROM notifications ORDER BY user_id`;
    expect(inbox).toHaveLength(2);
    expect(inbox.every((r) => r.type === "feedback.new")).toBe(true);

    const deliveries = await dbClient`
      SELECT channel, status FROM notification_deliveries
    `;
    // Defaults: in_app + email + ios_push for feedback.new × 2 users = 6 deliveries.
    expect(deliveries).toHaveLength(6);
    const inApp = deliveries.filter((d) => d.channel === "in_app");
    const email = deliveries.filter((d) => d.channel === "email");
    const push = deliveries.filter((d) => d.channel === "ios_push");
    expect(inApp).toHaveLength(2);
    expect(email).toHaveLength(2);
    expect(push).toHaveLength(2);
    expect(inApp.every((d) => d.status === "sent")).toBe(true);

    // Wait for in-process delivery jobs to complete.
    await new Promise((r) => setTimeout(r, 200));
    expect(testPushDeliveries.length).toBe(2);
  });

  it("respects per-channel preference overrides", async () => {
    await setUserPreference(ownerUserId, {
      notifications: { types: { "feedback.new": { email: false, ios_push: false } } },
    });

    await app.notificationDispatcher.enqueue({
      type: "feedback.new",
      userIds: [ownerUserId],
      teamId,
      payload: { title: "Quiet" },
    });

    const deliveries = await dbClient`SELECT channel FROM notification_deliveries`;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channel).toBe("in_app");
  });

  it("returns empty for empty userIds without inserting", async () => {
    const result = await app.notificationDispatcher.enqueue({
      type: "feedback.new",
      userIds: [],
      teamId,
      payload: { title: "nope" },
    });
    expect(result.notificationIds).toEqual([]);
    const inbox = await dbClient`SELECT id FROM notifications`;
    expect(inbox).toHaveLength(0);
  });

  it("dedupes duplicate userIds", async () => {
    await app.notificationDispatcher.enqueue({
      type: "feedback.new",
      userIds: [ownerUserId, ownerUserId, ownerUserId],
      teamId,
      payload: { title: "Once" },
    });
    const inbox = await dbClient`SELECT id FROM notifications WHERE user_id = ${ownerUserId}`;
    expect(inbox).toHaveLength(1);
  });

  it("batches large fan-outs into one notifications insert", async () => {
    // Seed 20 extra members on the same team.
    const memberIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const u = await createUserAndGetToken(app, `bulk${i}@owlmetry.com`);
      await addTeamMember(teamId, u.userId, "member");
      memberIds.push(u.userId);
    }

    await app.notificationDispatcher.enqueue({
      type: "issue.digest",
      userIds: [ownerUserId, ...memberIds],
      teamId,
      payload: { title: "21 issues", link: "/dashboard/issues" },
    });

    const inbox = await dbClient`SELECT id FROM notifications`;
    expect(inbox).toHaveLength(21);
    const inApp = await dbClient`
      SELECT count(*)::int AS n FROM notification_deliveries WHERE channel = 'in_app'
    `;
    expect(inApp[0].n).toBe(21);
  });
});
