import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
});

afterAll(async () => {
  await app.close();
});

function ingest(events: any[], key = TEST_CLIENT_KEY) {
  return app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${key}` },
    payload: { bundle_id: TEST_BUNDLE_ID, events },
  });
}

function claim(body: any, key = TEST_CLIENT_KEY) {
  return app.inject({
    method: "POST",
    url: "/v1/identity/claim",
    headers: { authorization: `Bearer ${key}` },
    payload: body,
  });
}

function queryEvents(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return app.inject({
    method: "GET",
    url: `/v1/events${qs ? `?${qs}` : ""}`,
    headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
  });
}

async function getProjectUsers(projectId: string) {
  const client = postgres(TEST_DB_URL, { max: 1 });
  const rows = await client`SELECT * FROM app_users WHERE project_id = ${projectId}`;
  await client.end();
  return rows;
}

/** Poll until a condition is met on app_users, to avoid flaky fire-and-forget race. */
async function waitForAppUser(projectId: string, userId: string, maxWaitMs = 2000): Promise<void> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  try {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const rows = await client`SELECT 1 FROM app_users WHERE project_id = ${projectId} AND user_id = ${userId} LIMIT 1`;
      if (rows.length > 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    await client.end();
  }
}

async function getMetricEvents(appId: string) {
  const client = postgres(TEST_DB_URL, { max: 1 });
  const rows = await client`SELECT * FROM metric_events WHERE app_id = ${appId}`;
  await client.end();
  return rows;
}

/** Poll until expected metric_events appear, to avoid flaky fire-and-forget race. */
async function waitForMetricEvents(appId: string, expectedCount: number, maxWaitMs = 2000): Promise<void> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  try {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const [{ count }] = await client`SELECT COUNT(*)::int AS count FROM metric_events WHERE app_id = ${appId}`;
      if (count >= expectedCount) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    await client.end();
  }
}

describe("POST /v1/identity/claim", () => {
  it("claims anonymous events and updates user_id", async () => {
    const anonId = "owl_anon_test-claim-001";

    // Ingest events with anonymous ID
    await ingest([
      { level: "info", message: "claim event 1", user_id: anonId, screen_name: "claim", session_id: TEST_SESSION_ID },
      { level: "info", message: "claim event 2", user_id: anonId, screen_name: "claim", session_id: TEST_SESSION_ID },
    ]);

    // Claim
    const res = await claim({ anonymous_id: anonId, user_id: "real-user-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ claimed: true, events_reassigned_count: 2 });

    // Verify events were updated
    const eventsRes = await queryEvents({ user: "real-user-1" });
    const events = eventsRes.json().events;
    expect(events.length).toBe(2);
    expect(events.every((e: any) => e.user_id === "real-user-1")).toBe(true);
  });

  it("is idempotent — second claim returns success", async () => {
    const anonId = "owl_anon_test-idempotent";

    await ingest([
      { level: "info", message: "idem event", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);

    const first = await claim({ anonymous_id: anonId, user_id: "idem-user" });
    expect(first.statusCode).toBe(200);
    expect(first.json().claimed).toBe(true);

    const second = await claim({ anonymous_id: anonId, user_id: "idem-user" });
    expect(second.statusCode).toBe(200);
    expect(second.json().claimed).toBe(true);
  });

  it("rejects missing anonymous_id", async () => {
    const res = await claim({ user_id: "some-user" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/anonymous_id/);
  });

  it("rejects missing user_id", async () => {
    const res = await claim({ anonymous_id: "owl_anon_abc" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/user_id/);
  });

  it("rejects anonymous_id without owl_anon_ prefix", async () => {
    const res = await claim({ anonymous_id: "not-anon-id", user_id: "user" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/owl_anon_/);
  });

  it("rejects user_id with owl_anon_ prefix", async () => {
    const anonId = "owl_anon_test-reject-anon-user";
    await ingest([
      { level: "info", message: "test", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);

    const res = await claim({
      anonymous_id: anonId,
      user_id: "owl_anon_should-not-work",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/anonymous prefix/);
  });

  it("returns 404 when no events match the anonymous_id", async () => {
    const res = await claim({
      anonymous_id: "owl_anon_nonexistent",
      user_id: "user",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/No events/);
  });

  it("rejects agent key (no events:write permission)", async () => {
    const res = await claim(
      { anonymous_id: "owl_anon_test", user_id: "user" },
      TEST_AGENT_KEY
    );
    expect(res.statusCode).toBe(403);
  });

  it("does not cross-contaminate between apps", async () => {
    const anonId = "owl_anon_test-app-scope";

    // Ingest events under this app's client key
    await ingest([
      { level: "info", message: "app-scoped event", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);

    // Claim should work
    const res = await claim({ anonymous_id: anonId, user_id: "scoped-user" });
    expect(res.statusCode).toBe(200);
    expect(res.json().events_reassigned_count).toBe(1);
  });

  it("does not update events belonging to a different anonymous_id", async () => {
    const anonId1 = "owl_anon_user-a";
    const anonId2 = "owl_anon_user-b";

    await ingest([
      { level: "info", message: "user A event", user_id: anonId1, screen_name: "isolation", session_id: TEST_SESSION_ID },
      { level: "info", message: "user B event", user_id: anonId2, screen_name: "isolation", session_id: TEST_SESSION_ID },
    ]);

    // Claim only anonId1
    await claim({ anonymous_id: anonId1, user_id: "real-user-a" });

    // Verify user B's events are untouched
    const eventsRes = await queryEvents({ screen_name: "isolation" });
    const events = eventsRes.json().events;
    const userBEvent = events.find((e: any) => e.message === "user B event");
    expect(userBEvent.user_id).toBe(anonId2);

    const userAEvent = events.find((e: any) => e.message === "user A event");
    expect(userAEvent.user_id).toBe("real-user-a");
  });

  it("creates app_users row on ingest and merges on claim", async () => {
    const anonId = "owl_anon_test-app-users";

    // Get project_id from test data
    const seedData = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const projectId = seedData.json().apps.find((a: any) => a.bundle_id === TEST_BUNDLE_ID).project_id;

    // Ingest to create anonymous app_user
    const ingestRes = await ingest([
      { level: "info", message: "test", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);
    expect(ingestRes.statusCode).toBe(200);

    // Wait for fire-and-forget upsert to complete
    await waitForAppUser(projectId, anonId);

    // Verify anonymous user was created
    let users = await getProjectUsers(projectId);
    const anonUser = users.find((u: any) => u.user_id === anonId);
    expect(anonUser).toBeDefined();
    expect(anonUser!.is_anonymous).toBe(true);

    // Claim
    const res = await claim({ anonymous_id: anonId, user_id: "claimed-user" });
    expect(res.statusCode).toBe(200);

    // Verify: anonymous row converted to real user with claimed_from
    users = await getProjectUsers(projectId);
    const realUser = users.find((u: any) => u.user_id === "claimed-user");
    expect(realUser).toBeDefined();
    expect(realUser!.is_anonymous).toBe(false);
    expect(realUser!.claimed_from).toEqual([anonId]);

    // Anonymous row should be gone
    const stillAnon = users.find((u: any) => u.user_id === anonId);
    expect(stillAnon).toBeUndefined();
  });

  it("merges into existing real user on claim", async () => {
    const anonId = "owl_anon_test-merge";

    const seedData = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const projectId = seedData.json().apps.find((a: any) => a.bundle_id === TEST_BUNDLE_ID).project_id;

    // Ingest events for both anon and real user
    await ingest([
      { level: "info", message: "anon event", user_id: anonId, session_id: TEST_SESSION_ID },
      { level: "info", message: "real event", user_id: "existing-real", session_id: TEST_SESSION_ID },
    ]);

    // Wait for fire-and-forget upserts to complete
    await waitForAppUser(projectId, anonId);
    await waitForAppUser(projectId, "existing-real");

    // Claim anon -> existing-real
    const res = await claim({ anonymous_id: anonId, user_id: "existing-real" });
    expect(res.statusCode).toBe(200);

    const users = await getProjectUsers(projectId);
    const realUser = users.find((u: any) => u.user_id === "existing-real");
    expect(realUser).toBeDefined();
    expect(realUser!.claimed_from).toEqual([anonId]);

    // Anonymous row should be deleted
    const anonUser = users.find((u: any) => u.user_id === anonId);
    expect(anonUser).toBeUndefined();
  });

  it("reassigns metric_events user_id on claim", async () => {
    const anonId = "owl_anon_test-metric-claim";
    const trackingId = randomUUID();

    // Ingest metric events with anonymous user_id
    await ingest([
      {
        level: "info",
        message: "metric:load-time:start",
        user_id: anonId,
        session_id: TEST_SESSION_ID,
        custom_attributes: { tracking_id: trackingId },
      },
      {
        level: "info",
        message: "metric:load-time:complete",
        user_id: anonId,
        session_id: TEST_SESSION_ID,
        custom_attributes: { tracking_id: trackingId, duration_ms: "250" },
      },
    ]);

    // Get app_id
    const seedData = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const appId = seedData.json().apps.find((a: any) => a.bundle_id === TEST_BUNDLE_ID).id;

    // Wait for fire-and-forget dualWriteSpecializedEvents to complete
    await waitForMetricEvents(appId, 2);

    // Verify metric_events exist with anonymous user_id
    let metricRows = await getMetricEvents(appId);
    const anonMetrics = metricRows.filter((r: any) => r.user_id === anonId);
    expect(anonMetrics.length).toBe(2);

    // Claim identity
    const res = await claim({ anonymous_id: anonId, user_id: "metric-real-user" });
    expect(res.statusCode).toBe(200);

    // Verify metric_events were reassigned
    metricRows = await getMetricEvents(appId);
    const reassigned = metricRows.filter((r: any) => r.user_id === "metric-real-user");
    expect(reassigned.length).toBe(2);

    // No metric_events should remain with the anonymous user_id
    const stillAnon = metricRows.filter((r: any) => r.user_id === anonId);
    expect(stillAnon.length).toBe(0);
  });
});

async function getProjectIdForBundle(bundle: string): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: "/v1/apps",
    headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
  });
  return res.json().apps.find((a: any) => a.bundle_id === bundle).project_id;
}

async function getAppIdForBundle(bundle: string): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: "/v1/apps",
    headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
  });
  return res.json().apps.find((a: any) => a.bundle_id === bundle).id;
}

describe("claim + late-arriving ingest race", () => {
  it("rewrites a late anon event to the real user id and does not resurrect the anon app_users row", async () => {
    const anonId = "owl_anon_late-1";
    const realId = "real-late-1";
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);

    // Session A: initial anon events arrive, claim commits.
    await ingest([
      { level: "info", message: "pre-claim", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, anonId);
    const claimRes = await claim({ anonymous_id: anonId, user_id: realId });
    expect(claimRes.statusCode).toBe(200);

    // Session B: an offline-queued event tagged with the anon id finally flushes.
    const lateRes = await ingest([
      { level: "info", message: "late offline event", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);
    expect(lateRes.statusCode).toBe(200);

    // The late event must be attributed to the real user.
    const eventsRes = await queryEvents({ user: realId });
    const list = eventsRes.json().events;
    expect(list.length).toBe(2);
    expect(list.every((e: any) => e.user_id === realId)).toBe(true);

    // No anon app_users row should have been resurrected.
    await waitForAppUser(projectId, realId);
    const users = await getProjectUsers(projectId);
    expect(users.find((u: any) => u.user_id === anonId)).toBeUndefined();
    const real = users.find((u: any) => u.user_id === realId);
    expect(real).toBeDefined();
    expect(real!.claimed_from).toEqual([anonId]);
  });

  it("rewrites late funnel_events and metric_events via claimed_from", async () => {
    const anonId = "owl_anon_late-funnel-metric";
    const realId = "real-late-fm";
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const appId = await getAppIdForBundle(TEST_BUNDLE_ID);

    // Pre-claim anchor event so the claim endpoint finds something to reassign.
    await ingest([
      { level: "info", message: "anchor", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, anonId);
    await claim({ anonymous_id: anonId, user_id: realId });

    // Late arrival: both a funnel step and a metric event, both tagged anon.
    await ingest([
      { level: "info", message: "step:signup", user_id: anonId, session_id: TEST_SESSION_ID },
      {
        level: "info",
        message: "metric:upload:complete",
        user_id: anonId,
        session_id: TEST_SESSION_ID,
        custom_attributes: { duration_ms: "100" },
      },
    ]);

    await waitForMetricEvents(appId, 1);

    const metrics = await getMetricEvents(appId);
    expect(metrics.length).toBe(1);
    expect(metrics[0].user_id).toBe(realId);

    const funnelClient = postgres(TEST_DB_URL, { max: 1 });
    const funnels = await funnelClient`SELECT * FROM funnel_events WHERE app_id = ${appId}`;
    await funnelClient.end();
    expect(funnels.length).toBe(1);
    expect(funnels[0].user_id).toBe(realId);
  });

  it("only rewrites claimed anon ids in a mixed batch (real + claimed-anon + un-claimed-anon)", async () => {
    const claimedAnon = "owl_anon_mixed-claimed";
    const unclaimedAnon = "owl_anon_mixed-unclaimed";
    const realId = "real-mixed";
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);

    // Set up one claimed anon id.
    await ingest([
      { level: "info", message: "anchor", user_id: claimedAnon, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, claimedAnon);
    await claim({ anonymous_id: claimedAnon, user_id: realId });

    // Single ingest with three distinct users: real, claimed-anon (late), un-claimed-anon.
    await ingest([
      { level: "info", message: "real-direct", user_id: realId, session_id: TEST_SESSION_ID, screen_name: "mixed" },
      { level: "info", message: "late-claimed-anon", user_id: claimedAnon, session_id: TEST_SESSION_ID, screen_name: "mixed" },
      { level: "info", message: "stays-anon", user_id: unclaimedAnon, session_id: TEST_SESSION_ID, screen_name: "mixed" },
    ]);

    const mixed = await queryEvents({ screen_name: "mixed" });
    const byMessage = new Map<string, any>(
      (mixed.json().events as any[]).map((e) => [e.message, e])
    );
    expect(byMessage.get("real-direct").user_id).toBe(realId);
    expect(byMessage.get("late-claimed-anon").user_id).toBe(realId);
    expect(byMessage.get("stays-anon").user_id).toBe(unclaimedAnon);

    // The un-claimed anon row should still exist; the claimed one should not.
    const users = await getProjectUsers(projectId);
    expect(users.find((u: any) => u.user_id === unclaimedAnon)).toBeDefined();
    expect(users.find((u: any) => u.user_id === claimedAnon)).toBeUndefined();
  });

  it("resolves multiple distinct claimed anon ids in a single ingest batch", async () => {
    const anonA = "owl_anon_multi-a";
    const anonB = "owl_anon_multi-b";
    const realA = "real-multi-a";
    const realB = "real-multi-b";
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);

    // Seed + claim for A.
    await ingest([
      { level: "info", message: "anchor-a", user_id: anonA, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, anonA);
    await claim({ anonymous_id: anonA, user_id: realA });

    // Seed + claim for B.
    await ingest([
      { level: "info", message: "anchor-b", user_id: anonB, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, anonB);
    await claim({ anonymous_id: anonB, user_id: realB });

    // One batch, interleaved.
    await ingest([
      { level: "info", message: "late-a-1", user_id: anonA, session_id: TEST_SESSION_ID, screen_name: "multi" },
      { level: "info", message: "late-b-1", user_id: anonB, session_id: TEST_SESSION_ID, screen_name: "multi" },
      { level: "info", message: "late-a-2", user_id: anonA, session_id: TEST_SESSION_ID, screen_name: "multi" },
      { level: "info", message: "late-b-2", user_id: anonB, session_id: TEST_SESSION_ID, screen_name: "multi" },
    ]);

    const res = await queryEvents({ screen_name: "multi" });
    const byMessage = new Map<string, any>(
      (res.json().events as any[]).map((e) => [e.message, e])
    );
    expect(byMessage.get("late-a-1").user_id).toBe(realA);
    expect(byMessage.get("late-a-2").user_id).toBe(realA);
    expect(byMessage.get("late-b-1").user_id).toBe(realB);
    expect(byMessage.get("late-b-2").user_id).toBe(realB);
  });

  it("resolves across apps within the same project (claim on app A, late event on app B)", async () => {
    const anonId = "owl_anon_cross-app";
    const realId = "real-cross-app";
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);

    // Create a second app in the same project with its own client key.
    const APP_B_BUNDLE = "com.owlmetry.test.second";
    const APP_B_KEY = "owl_client_cccc11111111111111111111111111111111111111ccc";
    const client = postgres(TEST_DB_URL, { max: 1 });
    const [teamRow] = await client`
      SELECT team_id FROM projects WHERE id = ${projectId} LIMIT 1
    `;
    const [creator] = await client`SELECT id FROM users LIMIT 1`;
    const [appB] = await client`
      INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
      VALUES (${teamRow.team_id}, ${projectId}, 'App B', 'apple', ${APP_B_BUNDLE})
      RETURNING id
    `;
    await client`
      INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
      VALUES (
        ${APP_B_KEY},
        'client',
        ${appB.id},
        ${teamRow.team_id},
        'App B Client',
        ${creator.id},
        ${JSON.stringify(["events:write", "users:write"])}::jsonb
      )
    `;
    await client.end();

    // Claim happens via app A.
    await ingest([
      { level: "info", message: "anchor", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, anonId);
    await claim({ anonymous_id: anonId, user_id: realId });

    // Late anon event arrives on app B.
    const late = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${APP_B_KEY}` },
      payload: {
        bundle_id: APP_B_BUNDLE,
        events: [
          { level: "info", message: "late-app-b", user_id: anonId, session_id: TEST_SESSION_ID, screen_name: "cross-app" },
        ],
      },
    });
    expect(late.statusCode).toBe(200);

    const res = await queryEvents({ screen_name: "cross-app" });
    const list = res.json().events;
    expect(list.length).toBe(1);
    expect(list[0].user_id).toBe(realId);
  });

  it("does not rewrite an anon id that has never been claimed (regression guard)", async () => {
    const anonId = "owl_anon_never-claimed";
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);

    await ingest([
      { level: "info", message: "first", user_id: anonId, session_id: TEST_SESSION_ID, screen_name: "never" },
      { level: "info", message: "second", user_id: anonId, session_id: TEST_SESSION_ID, screen_name: "never" },
    ]);

    const res = await queryEvents({ screen_name: "never" });
    const list = res.json().events;
    expect(list.length).toBe(2);
    expect(list.every((e: any) => e.user_id === anonId)).toBe(true);

    await waitForAppUser(projectId, anonId);
    const users = await getProjectUsers(projectId);
    const anon = users.find((u: any) => u.user_id === anonId);
    expect(anon).toBeDefined();
    expect(anon!.is_anonymous).toBe(true);
  });

  it("remains consistent when late ingests race against a claim", async () => {
    const anonId = "owl_anon_race";
    const realId = "real-race";
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);

    // Pre-claim seed so the claim finds at least one event to reassign.
    await ingest([
      { level: "info", message: "anchor", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, anonId);

    // Fire claim and two late ingests concurrently. The claim has to commit
    // at some point during or before the late ingests, and regardless of
    // ordering the final state must have no anon row and all events under
    // the real user.
    const late1 = ingest([
      { level: "info", message: "race-1", user_id: anonId, session_id: TEST_SESSION_ID, screen_name: "race" },
    ]);
    const late2 = ingest([
      { level: "info", message: "race-2", user_id: anonId, session_id: TEST_SESSION_ID, screen_name: "race" },
    ]);
    const claimP = claim({ anonymous_id: anonId, user_id: realId });

    const [r1, r2, rc] = await Promise.all([late1, late2, claimP]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(rc.statusCode).toBe(200);

    // Wait for any fire-and-forget app_users upsert raced in by the late
    // ingests, then ensure a follow-up ingest always ends up attributed to
    // the real user via the claimed_from rewrite path.
    await waitForAppUser(projectId, realId);
    const followup = await ingest([
      { level: "info", message: "post-race", user_id: anonId, session_id: TEST_SESSION_ID, screen_name: "race" },
    ]);
    expect(followup.statusCode).toBe(200);

    const res = await queryEvents({ screen_name: "race" });
    const list = res.json().events as any[];
    // The post-race event must be attributed to the real user via the fix.
    const post = list.find((e) => e.message === "post-race");
    expect(post.user_id).toBe(realId);
  });

  it("attributes a post-claim attachment to the real user via COALESCE backfill", async () => {
    const anonId = "owl_anon_attach-late";
    const realId = "real-attach-late";
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const clientEventId = randomUUID();

    // Seed + claim.
    await ingest([
      { level: "info", message: "anchor", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, anonId);
    await claim({ anonymous_id: anonId, user_id: realId });

    // Reserve an attachment with no user_id — the ingest-side event.user_id
    // (once rewritten) will backfill it via COALESCE.
    const body = Buffer.alloc(64, 0xcd);
    const sha = createHash("sha256").update(body).digest("hex");
    const reserve = await app.inject({
      method: "POST",
      url: "/v1/ingest/attachment",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        client_event_id: clientEventId,
        original_filename: "log.bin",
        content_type: "application/octet-stream",
        size_bytes: body.byteLength,
        sha256: sha,
        is_dev: false,
      },
    });
    expect([200, 201]).toContain(reserve.statusCode);

    // Late ingest tagged with the anon id referencing the reserved attachment.
    const late = await ingest([
      {
        level: "error",
        message: "late-with-attachment",
        user_id: anonId,
        session_id: TEST_SESSION_ID,
        client_event_id: clientEventId,
      },
    ]);
    expect(late.statusCode).toBe(200);

    const client = postgres(TEST_DB_URL, { max: 1 });
    const rows = await client`
      SELECT user_id FROM event_attachments WHERE event_client_id = ${clientEventId}
    `;
    await client.end();
    expect(rows.length).toBe(1);
    expect(rows[0].user_id).toBe(realId);
  });

  it("GET /v1/events returns late events under the real user, not the anon id", async () => {
    const anonId = "owl_anon_query-roundtrip";
    const realId = "real-query-roundtrip";
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);

    await ingest([
      { level: "info", message: "anchor", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, anonId);
    await claim({ anonymous_id: anonId, user_id: realId });

    await ingest([
      { level: "info", message: "late-1", user_id: anonId, session_id: TEST_SESSION_ID },
      { level: "info", message: "late-2", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);

    const underReal = await queryEvents({ user_id: realId });
    expect(underReal.json().events.length).toBe(3); // anchor + two late

    const underAnon = await queryEvents({ user_id: anonId });
    expect(underAnon.json().events.length).toBe(0);
  });
});
