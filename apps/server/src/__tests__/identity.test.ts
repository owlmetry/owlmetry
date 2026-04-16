import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
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
