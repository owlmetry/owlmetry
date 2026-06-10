import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
  buildApp,
  insertAppUser,
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

  it("succeeds with events_reassigned_count=0 when no events match the anonymous_id", async () => {
    // Even with zero events to reassign, the claim must register the anon→real
    // mapping in app_users.claimed_from. Otherwise late-arriving anon events
    // (sent by an SDK that beat its own ingest flush — see CLAUDE.md "Identity"
    // section) bypass resolveClaimedUserIds and orphan onto a separate row.
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const anonId = "owl_anon_nonexistent";
    const realId = "user";

    const res = await claim({ anonymous_id: anonId, user_id: realId });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ claimed: true, events_reassigned_count: 0 });

    // Real user row created with claimed_from set
    const users = await getProjectUsers(projectId);
    const realRow = users.find((u: any) => u.user_id === realId);
    expect(realRow).toBeDefined();
    expect(realRow!.is_anonymous).toBe(false);
    expect(realRow!.claimed_from).toEqual([anonId]);
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

/**
 * Reproduction of the Signature Creator orphan bug — anon row created by the
 * attribution endpoint, then a Firebase-anon-auth setUser fires the claim
 * before the SDK's own log Tasks have reached the EventTransport buffer. The
 * server must register claimed_from on the real user row even when zero
 * events are reassigned, and the merge of an existing anon row must run
 * unconditionally, so late-arriving events are rewritten via
 * resolveClaimedUserIds at /v1/ingest.
 */
describe("POST /v1/identity/claim — robustness against zero-event races", () => {
  it("merges a pre-existing anon app_users row when zero events are present", async () => {
    // Mimics the production case: the attribution endpoint created the anon
    // app_users row before any events were ingested. The claim arrives while
    // the events are still in flight on the SDK side.
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const anonId = "owl_anon_test-A-zero-events-with-anon-row";
    const realId = "real-test-A";

    await insertAppUser(projectId, anonId, {
      isAnonymous: true,
      properties: { attribution_source: "none" },
    });

    const res = await claim({ anonymous_id: anonId, user_id: realId });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ claimed: true, events_reassigned_count: 0 });

    const users = await getProjectUsers(projectId);

    // No row should remain with the anon user_id (the merge either renamed
    // it in place or deleted it after copying its junctions to the real row).
    expect(users.find((u: any) => u.user_id === anonId)).toBeUndefined();

    // Real row exists with claimed_from + properties carried over
    const realRow = users.find((u: any) => u.user_id === realId);
    expect(realRow).toBeDefined();
    expect(realRow!.is_anonymous).toBe(false);
    expect(realRow!.claimed_from).toEqual([anonId]);
    expect(realRow!.properties).toEqual({ attribution_source: "none" });
  });

  it("creates a real app_users row with claimed_from when no rows exist at all", async () => {
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const anonId = "owl_anon_test-B-no-rows";
    const realId = "real-test-B";

    const res = await claim({ anonymous_id: anonId, user_id: realId });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ claimed: true, events_reassigned_count: 0 });

    const users = await getProjectUsers(projectId);
    expect(users.find((u: any) => u.user_id === anonId)).toBeUndefined();

    const realRow = users.find((u: any) => u.user_id === realId);
    expect(realRow).toBeDefined();
    expect(realRow!.is_anonymous).toBe(false);
    expect(realRow!.claimed_from).toEqual([anonId]);
  });

  it("rewrites a late anon ingest to the real user when the claim ran with zero events", async () => {
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const anonId = "owl_anon_test-C-late-after-zero-claim";
    const realId = "real-test-C";

    // Pre-insert anon row only (no events) — same shape as Test A
    await insertAppUser(projectId, anonId, { isAnonymous: true });

    const claimRes = await claim({ anonymous_id: anonId, user_id: realId });
    expect(claimRes.statusCode).toBe(200);

    // Now an anon event arrives (e.g., from an in-flight log Task that
    // reached the SDK's transport buffer after the claim POST went out).
    await ingest([
      { level: "info", message: "late-after-zero-claim", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);

    const underReal = await queryEvents({ user_id: realId });
    expect(underReal.json().events.length).toBe(1);
    expect(underReal.json().events[0].user_id).toBe(realId);

    const underAnon = await queryEvents({ user_id: anonId });
    expect(underAnon.json().events.length).toBe(0);

    const users = await getProjectUsers(projectId);
    expect(users.find((u: any) => u.user_id === anonId)).toBeUndefined();
  });

  it("does not orphan an anon app_users row when ingest and claim run concurrently", async () => {
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const anonId = "owl_anon_test-D-concurrent";
    const realId = "real-test-D";

    // Anchor: ensure anon row exists via the awaited ingest path so this
    // test focuses on the in-flight ingest race, not on the missing-anon-row
    // path that Tests A/B already cover.
    await ingest([
      { level: "info", message: "anchor", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, anonId);

    // Fire a second ingest in parallel with the claim — the bug is that
    // this ingest's events can land while the claim's events-table UPDATE
    // is mid-transaction, leaving stragglers under the anon id.
    const [, claimRes] = await Promise.all([
      ingest([
        { level: "info", message: "concurrent-1", user_id: anonId, session_id: TEST_SESSION_ID },
        { level: "info", message: "concurrent-2", user_id: anonId, session_id: TEST_SESSION_ID },
      ]),
      claim({ anonymous_id: anonId, user_id: realId }),
    ]);
    expect(claimRes.statusCode).toBe(200);

    // Drain any straggler late events the same way the SDK would: by
    // sending them after the claim. With the server fix, claimed_from is
    // set on the real user row, so resolveClaimedUserIds rewrites them.
    await ingest([
      { level: "info", message: "post-claim-late", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);

    const users = await getProjectUsers(projectId);
    expect(users.find((u: any) => u.user_id === anonId)).toBeUndefined();
    const realRow = users.find((u: any) => u.user_id === realId);
    expect(realRow).toBeDefined();
    expect(realRow!.claimed_from).toEqual([anonId]);

    const underAnon = await queryEvents({ user_id: anonId });
    expect(underAnon.json().events.length).toBe(0);
  });

  it("sweeps an orphaned anon app_users row re-created by a racing upsert (deterministic)", async () => {
    // Deterministic replay of the interleaving the concurrent test above can
    // only hit probabilistically: an ingest's resolveClaimedUserIds runs
    // before the claim commits (no mapping → batch stays anon), the claim
    // then renames/deletes the anon app_users row, and the ingest's awaited
    // upsertAppUsers re-INSERTs the anon row afterwards — an orphan with
    // claimed_from = null that nothing rewrote before the straggler sweep
    // learned to merge app_users too.
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const anonId = "owl_anon_test-E-orphan-replay";
    const realId = "real-test-E";

    // 1. Anchor ingest creates the anon row the claim will rename in place.
    await ingest([
      { level: "info", message: "anchor", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);
    await waitForAppUser(projectId, anonId);

    // 2. Claim renames the anon row to the real id + registers claimed_from.
    const claimRes = await claim({ anonymous_id: anonId, user_id: realId });
    expect(claimRes.statusCode).toBe(200);

    // 3. Simulate the racing ingest's stale upsertAppUsers landing after the
    //    claim: re-insert the anon row (claimed_from null), with a property
    //    so the sweep's merge semantics are observable.
    await insertAppUser(projectId, anonId, {
      isAnonymous: true,
      properties: { straggler_prop: "from-anon" },
    });

    // 4. The SDK's next straggler ingest with the same anon id triggers the
    //    sweep, which must fold the orphan back into the real row.
    await ingest([
      { level: "info", message: "straggler", user_id: anonId, session_id: TEST_SESSION_ID },
    ]);

    const users = await getProjectUsers(projectId);
    expect(users.find((u: any) => u.user_id === anonId)).toBeUndefined();
    const realRow = users.find((u: any) => u.user_id === realId);
    expect(realRow).toBeDefined();
    expect(realRow!.claimed_from).toEqual([anonId]);
    // Orphan's properties carried over (real-row keys would win on conflict).
    expect(realRow!.properties).toMatchObject({ straggler_prop: "from-anon" });

    const underAnon = await queryEvents({ user_id: anonId });
    expect(underAnon.json().events.length).toBe(0);
    const underReal = await queryEvents({ user_id: realId });
    expect(underReal.json().events.length).toBe(2);
  });
});

describe("POST /v1/identity/claim — questionnaire response migration", () => {
  // Seed a questionnaire directly via SQL so the test doesn't depend on the
  // dashboard route. Each test runs against a freshly truncated DB.
  async function seedQuestionnaire(projectId: string, slug: string) {
    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      const schema = {
        version: 1,
        questions: [
          { id: "q1", type: "text", title: "Q1", required: true },
          { id: "q2", type: "text", title: "Q2", required: false },
        ],
      };
      const [row] = await client`
        INSERT INTO questionnaires (project_id, slug, name, schema, is_active)
        VALUES (${projectId}, ${slug}, 'Test Q', ${JSON.stringify(schema)}::jsonb, true)
        RETURNING id
      `;
      return row.id as string;
    } finally {
      await client.end();
    }
  }

  function saveResponse(
    slug: string,
    userId: string,
    isComplete: boolean,
    answers: Record<string, unknown>,
  ) {
    return app.inject({
      method: "POST",
      url: `/v1/questionnaires/${slug}/responses`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, user_id: userId, is_complete: isComplete, answers },
    });
  }

  async function getResponses(projectId: string, slug: string) {
    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      return await client`
        SELECT id, user_id, submitted_at, deleted_at FROM questionnaire_responses
        WHERE project_id = ${projectId} AND slug = ${slug}
        ORDER BY created_at
      `;
    } finally {
      await client.end();
    }
  }

  it("migrates an anon draft's user_id to the real id when no real-user row exists for the slug", async () => {
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    await seedQuestionnaire(projectId, "onboarding-survey");

    const anonId = "owl_anon_qclaim-1";
    const realId = "real-qclaim-1";

    const draft = await saveResponse("onboarding-survey", anonId, false, { q1: "in progress" });
    expect(draft.statusCode).toBe(201);

    const before = await getResponses(projectId, "onboarding-survey");
    expect(before).toHaveLength(1);
    expect(before[0]!.user_id).toBe(anonId);

    const res = await claim({ anonymous_id: anonId, user_id: realId });
    expect(res.statusCode).toBe(200);

    const after = await getResponses(projectId, "onboarding-survey");
    expect(after).toHaveLength(1);
    expect(after[0]!.user_id).toBe(realId);
    expect(after[0]!.deleted_at).toBeNull();
    expect(after[0]!.submitted_at).toBeNull(); // still a draft, now under the real id
  });

  it("soft-deletes the anon draft when the real user already has a submitted response for the same slug", async () => {
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    await seedQuestionnaire(projectId, "onboarding-survey");

    const anonId = "owl_anon_qclaim-2";
    const realId = "real-qclaim-2";

    expect(
      (await saveResponse("onboarding-survey", realId, true, { q1: "real submitted", q2: "x" })).statusCode,
    ).toBe(201);
    expect(
      (await saveResponse("onboarding-survey", anonId, false, { q1: "anon draft" })).statusCode,
    ).toBe(201);

    const res = await claim({ anonymous_id: anonId, user_id: realId });
    expect(res.statusCode).toBe(200);

    const after = await getResponses(projectId, "onboarding-survey");
    expect(after).toHaveLength(2);
    const realRow = after.find((r: any) => r.user_id === realId && r.deleted_at === null);
    expect(realRow).toBeDefined();
    expect(realRow!.submitted_at).not.toBeNull();
    const anonRow = after.find((r: any) => r.user_id === anonId);
    expect(anonRow).toBeDefined();
    expect(anonRow!.deleted_at).not.toBeNull();
  });

  it("handles mixed slugs: migrates non-conflicting + soft-deletes conflicting in one claim", async () => {
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    await seedQuestionnaire(projectId, "slug-a");
    await seedQuestionnaire(projectId, "slug-b");

    const anonId = "owl_anon_qclaim-3";
    const realId = "real-qclaim-3";

    expect((await saveResponse("slug-a", anonId, false, { q1: "anon-a" })).statusCode).toBe(201);
    expect((await saveResponse("slug-b", anonId, false, { q1: "anon-b" })).statusCode).toBe(201);
    expect((await saveResponse("slug-b", realId, true, { q1: "real-b" })).statusCode).toBe(201);

    const res = await claim({ anonymous_id: anonId, user_id: realId });
    expect(res.statusCode).toBe(200);

    const aRows = await getResponses(projectId, "slug-a");
    expect(aRows).toHaveLength(1);
    expect(aRows[0]!.user_id).toBe(realId);
    expect(aRows[0]!.deleted_at).toBeNull();

    const bRows = await getResponses(projectId, "slug-b");
    expect(bRows).toHaveLength(2);
    const realB = bRows.find((r: any) => r.user_id === realId && r.deleted_at === null);
    expect(realB).toBeDefined();
    expect(realB!.submitted_at).not.toBeNull();
    const anonB = bRows.find((r: any) => r.user_id === anonId);
    expect(anonB!.deleted_at).not.toBeNull();
  });
});

describe("POST /v1/identity/claim — non-event end-user table rewrites", () => {
  it("reassigns issue_occurrences.user_id on claim, scoped to the project", async () => {
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const appId = await getAppIdForBundle(TEST_BUNDLE_ID);
    const anonId = "owl_anon_occ-claim";
    const realId = "real-occ-claim";

    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      const [issueRow] = await client`
        INSERT INTO issues (project_id, app_id, title, first_seen_at, last_seen_at)
        VALUES (${projectId}, ${appId}, 'TypeError: x is undefined', now(), now())
        RETURNING id
      `;
      const issueId = issueRow!.id as string;
      await client`
        INSERT INTO issue_occurrences (issue_id, session_id, user_id, timestamp)
        VALUES (${issueId}, ${randomUUID()}, ${anonId}, now()),
               (${issueId}, ${randomUUID()}, ${anonId}, now())
      `;

      const before = await client`SELECT user_id FROM issue_occurrences WHERE issue_id = ${issueId}`;
      expect(before.filter((r: any) => r.user_id === anonId)).toHaveLength(2);

      const res = await claim({ anonymous_id: anonId, user_id: realId });
      expect(res.statusCode).toBe(200);

      const after = await client`SELECT user_id FROM issue_occurrences WHERE issue_id = ${issueId}`;
      expect(after.filter((r: any) => r.user_id === realId)).toHaveLength(2);
      expect(after.filter((r: any) => r.user_id === anonId)).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it("reassigns feedback.user_id on claim, leaving soft-deleted rows untouched", async () => {
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const appId = await getAppIdForBundle(TEST_BUNDLE_ID);
    const anonId = "owl_anon_fb-claim";
    const realId = "real-fb-claim";

    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      await client`
        INSERT INTO feedback (app_id, project_id, user_id, message)
        VALUES (${appId}, ${projectId}, ${anonId}, 'live feedback')
      `;
      await client`
        INSERT INTO feedback (app_id, project_id, user_id, message, deleted_at)
        VALUES (${appId}, ${projectId}, ${anonId}, 'tombstone', now())
      `;

      const res = await claim({ anonymous_id: anonId, user_id: realId });
      expect(res.statusCode).toBe(200);

      const after = await client`
        SELECT user_id, deleted_at FROM feedback WHERE project_id = ${projectId} ORDER BY created_at
      `;
      const live = after.find((r: any) => r.deleted_at === null)!;
      expect(live.user_id).toBe(realId);
      const tombstone = after.find((r: any) => r.deleted_at !== null)!;
      expect(tombstone.user_id).toBe(anonId);
    } finally {
      await client.end();
    }
  });

  it("reassigns event_attachments.user_id on claim, leaving soft-deleted rows untouched", async () => {
    const projectId = await getProjectIdForBundle(TEST_BUNDLE_ID);
    const appId = await getAppIdForBundle(TEST_BUNDLE_ID);
    const anonId = "owl_anon_att-claim";
    const realId = "real-att-claim";
    const sha = createHash("sha256").update("test").digest("hex");

    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      await client`
        INSERT INTO event_attachments (project_id, app_id, user_id, original_filename, content_type, size_bytes, sha256, storage_path)
        VALUES (${projectId}, ${appId}, ${anonId}, 'a.log', 'text/plain', 4, ${sha}, '/tmp/a'),
               (${projectId}, ${appId}, ${anonId}, 'b.log', 'text/plain', 4, ${sha}, '/tmp/b')
      `;
      await client`
        INSERT INTO event_attachments (project_id, app_id, user_id, original_filename, content_type, size_bytes, sha256, storage_path, deleted_at)
        VALUES (${projectId}, ${appId}, ${anonId}, 'gone.log', 'text/plain', 4, ${sha}, '/tmp/gone', now())
      `;

      const res = await claim({ anonymous_id: anonId, user_id: realId });
      expect(res.statusCode).toBe(200);

      const after = await client`
        SELECT user_id, deleted_at FROM event_attachments WHERE project_id = ${projectId}
      `;
      const live = after.filter((r: any) => r.deleted_at === null);
      expect(live).toHaveLength(2);
      expect(live.every((r: any) => r.user_id === realId)).toBe(true);
      const tombstone = after.find((r: any) => r.deleted_at !== null)!;
      expect(tombstone.user_id).toBe(anonId);
    } finally {
      await client.end();
    }
  });
});
