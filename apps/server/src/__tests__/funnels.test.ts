import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createAgentKey,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
} from "./setup.js";

let app: FastifyInstance;
let token: string;
let teamId: string;
let projectId: string;
let appId: string;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  projectId = seed.projectId;
  appId = seed.appId;
  const auth = await getTokenAndTeamId(app);
  token = auth.token;
  teamId = auth.teamId;
});

afterAll(async () => {
  await app.close();
});

function createFunnel(payload: any, authToken = token) {
  return app.inject({
    method: "POST",
    url: "/v1/funnels",
    headers: { authorization: `Bearer ${authToken}` },
    payload,
  });
}

function ingest(events: any[], key = TEST_CLIENT_KEY) {
  return app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${key}` },
    payload: { bundle_id: TEST_BUNDLE_ID, events },
  });
}

const ONBOARDING_STEPS = [
  { name: "Welcome", event_filter: { message: "track:welcome" } },
  { name: "Sign Up", event_filter: { message: "track:signup" } },
  { name: "Complete Profile", event_filter: { message: "track:complete-profile" } },
];

describe("Funnel Definitions CRUD", () => {
  it("creates a funnel definition", async () => {
    const res = await createFunnel({
      project_id: projectId,
      name: "Onboarding",
      slug: "onboarding",
      description: "Tracks onboarding flow",
      steps: ONBOARDING_STEPS,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.slug).toBe("onboarding");
    expect(body.name).toBe("Onboarding");
    expect(body.description).toBe("Tracks onboarding flow");
    expect(body.steps).toHaveLength(3);
    expect(body.project_id).toBe(projectId);
  });

  it("rejects duplicate slug in same project", async () => {
    await createFunnel({
      project_id: projectId,
      name: "Funnel A",
      slug: "test-funnel",
      steps: ONBOARDING_STEPS,
    });

    const res = await createFunnel({
      project_id: projectId,
      name: "Funnel B",
      slug: "test-funnel",
      steps: ONBOARDING_STEPS,
    });

    expect(res.statusCode).toBe(409);
  });

  it("rejects invalid slug", async () => {
    const res = await createFunnel({
      project_id: projectId,
      name: "Test",
      slug: "Invalid Slug!",
      steps: ONBOARDING_STEPS,
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects empty steps", async () => {
    const res = await createFunnel({
      project_id: projectId,
      name: "Test",
      slug: "test",
      steps: [],
    });

    expect(res.statusCode).toBe(400);
  });

  it("lists funnel definitions for a project", async () => {
    await createFunnel({ project_id: projectId, name: "Funnel A", slug: "funnel-a", steps: ONBOARDING_STEPS });
    await createFunnel({ project_id: projectId, name: "Funnel B", slug: "funnel-b", steps: ONBOARDING_STEPS });

    const agentKey = await createAgentKey(app, token, teamId, ["funnels:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels?project_id=${projectId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().funnels).toHaveLength(2);
  });

  it("gets a single funnel by slug", async () => {
    await createFunnel({ project_id: projectId, name: "Test", slug: "test-funnel", steps: ONBOARDING_STEPS });

    const agentKey = await createAgentKey(app, token, teamId, ["funnels:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/test-funnel?project_id=${projectId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe("test-funnel");
  });

  it("updates a funnel definition", async () => {
    await createFunnel({ project_id: projectId, name: "Original", slug: "test-funnel", steps: ONBOARDING_STEPS });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/funnels/test-funnel?project_id=${projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Updated Name", description: "New description" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Name");
    expect(res.json().description).toBe("New description");
  });

  it("soft deletes a funnel (user-only)", async () => {
    await createFunnel({ project_id: projectId, name: "To Delete", slug: "to-delete", steps: ONBOARDING_STEPS });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/funnels/to-delete?project_id=${projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);

    // Verify it's gone from listings
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/funnels?project_id=${projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json().funnels).toHaveLength(0);
  });

  it("rejects agent key delete with 403", async () => {
    await createFunnel({ project_id: projectId, name: "Test", slug: "test-funnel", steps: ONBOARDING_STEPS });

    const agentKey = await createAgentKey(app, token, teamId, ["funnels:read", "funnels:write"]);
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/funnels/test-funnel?project_id=${projectId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("enforces funnels:read permission", async () => {
    const agentKey = await createAgentKey(app, token, teamId, ["events:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels?project_id=${projectId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("enforces funnels:write permission for create", async () => {
    const agentKey = await createAgentKey(app, token, teamId, ["funnels:read"]);
    const res = await createFunnel(
      { project_id: projectId, name: "Test", slug: "test", steps: ONBOARDING_STEPS },
      agentKey,
    );

    expect(res.statusCode).toBe(403);
  });
});

describe("Funnel Analytics", () => {
  async function seedFunnelEvents() {
    const now = Date.now();
    // User A completes all 3 steps in order
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-a", timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:signup", session_id: TEST_SESSION_ID, user_id: "user-a", timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:complete-profile", session_id: TEST_SESSION_ID, user_id: "user-a", timestamp: new Date(now - 40000).toISOString() },
    ]);
    // User B completes steps 1 and 2 only
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-b", timestamp: new Date(now - 30000).toISOString() },
      { level: "info", message: "track:signup", session_id: TEST_SESSION_ID, user_id: "user-b", timestamp: new Date(now - 20000).toISOString() },
    ]);
    // User C completes step 1 only
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-c", timestamp: new Date(now - 10000).toISOString() },
    ]);

    // Wait a moment for fire-and-forget writes
    await new Promise((r) => setTimeout(r, 200));
  }

  it("computes closed funnel analytics correctly", async () => {
    await createFunnel({ project_id: projectId, name: "Onboarding", slug: "onboarding", steps: ONBOARDING_STEPS });
    await seedFunnelEvents();

    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/onboarding/query?project_id=${projectId}&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { analytics } = res.json();
    expect(analytics.mode).toBe("closed");
    expect(analytics.total_users).toBe(3);
    expect(analytics.steps).toHaveLength(3);

    // Step 0: all 3 users
    expect(analytics.steps[0].unique_users).toBe(3);
    expect(analytics.steps[0].percentage).toBe(100);

    // Step 1: 2 users (A and B)
    expect(analytics.steps[1].unique_users).toBe(2);

    // Step 2: 1 user (A only)
    expect(analytics.steps[2].unique_users).toBe(1);
  });

  it("computes open funnel analytics correctly", async () => {
    await createFunnel({ project_id: projectId, name: "Onboarding", slug: "onboarding", steps: ONBOARDING_STEPS });
    await seedFunnelEvents();

    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/onboarding/query?project_id=${projectId}&mode=open&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { analytics } = res.json();
    expect(analytics.mode).toBe("open");

    // Open funnel: each step counts independently
    expect(analytics.steps[0].unique_users).toBe(3); // 3 did welcome
    expect(analytics.steps[1].unique_users).toBe(2); // 2 did signup
    expect(analytics.steps[2].unique_users).toBe(1); // 1 did complete-profile
  });

  it("returns zeros for empty funnel", async () => {
    await createFunnel({ project_id: projectId, name: "Empty", slug: "empty", steps: ONBOARDING_STEPS });

    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/empty/query?project_id=${projectId}&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { analytics } = res.json();
    expect(analytics.total_users).toBe(0);
    expect(analytics.steps[0].unique_users).toBe(0);
  });

  it("filters by data_mode", async () => {
    await createFunnel({ project_id: projectId, name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    // Ingest debug events
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-debug", is_debug: true, timestamp: new Date(now - 5000).toISOString() },
    ]);
    // Ingest production events
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-prod", is_debug: false, timestamp: new Date(now - 4000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    // Production only (default)
    const prodRes = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&data_mode=production`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(prodRes.json().analytics.steps[0].unique_users).toBe(1);

    // Debug only
    const debugRes = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&data_mode=debug`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(debugRes.json().analytics.steps[0].unique_users).toBe(1);

    // All
    const allRes = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(allRes.json().analytics.steps[0].unique_users).toBe(2);
  });

  it("filters by environment", async () => {
    await createFunnel({ project_id: projectId, name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-ios", environment: "ios", timestamp: new Date(now - 5000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-android", environment: "android", timestamp: new Date(now - 4000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&environment=ios&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().analytics.steps[0].unique_users).toBe(1);
  });

  it("filters by experiment", async () => {
    await createFunnel({ project_id: projectId, name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-a", experiments: { onboarding: "A" }, timestamp: new Date(now - 5000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-b", experiments: { onboarding: "B" }, timestamp: new Date(now - 4000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&experiment=onboarding:A&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().analytics.steps[0].unique_users).toBe(1);
  });

  it("excludes NULL user_id from analytics", async () => {
    await createFunnel({ project_id: projectId, name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    // Event without user_id
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, timestamp: new Date(now - 5000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().analytics.steps[0].unique_users).toBe(0);
  });

  it("computes correct drop-off math", async () => {
    await createFunnel({ project_id: projectId, name: "Test", slug: "test", steps: ONBOARDING_STEPS });
    await seedFunnelEvents();

    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    const { steps } = res.json().analytics;

    // Step 0: 3 users, no drop-off
    expect(steps[0].drop_off_count).toBe(0);
    expect(steps[0].drop_off_percentage).toBe(0);

    // Step 1: 2 users, drop-off of 1 from step 0
    expect(steps[1].drop_off_count).toBe(1);

    // Step 2: 1 user, drop-off of 1 from step 1
    expect(steps[2].drop_off_count).toBe(1);
  });

  it("groups by environment", async () => {
    await createFunnel({ project_id: projectId, name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-ios-1", environment: "ios", timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:signup", session_id: TEST_SESSION_ID, user_id: "user-ios-1", environment: "ios", timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-android-1", environment: "android", timestamp: new Date(now - 40000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&group_by=environment&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { analytics } = res.json();
    expect(analytics.breakdown).toBeDefined();
    expect(analytics.breakdown.length).toBeGreaterThanOrEqual(2);

    const iosGroup = analytics.breakdown.find((b: any) => b.value === "ios");
    expect(iosGroup).toBeDefined();
    expect(iosGroup.steps[0].unique_users).toBe(1);

    const androidGroup = analytics.breakdown.find((b: any) => b.value === "android");
    expect(androidGroup).toBeDefined();
    expect(androidGroup.steps[0].unique_users).toBe(1);
  });

  it("groups by experiment variant", async () => {
    await createFunnel({ project_id: projectId, name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-a1", experiments: { onboarding: "A" }, timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-b1", experiments: { onboarding: "B" }, timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-b2", experiments: { onboarding: "B" }, timestamp: new Date(now - 40000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&group_by=experiment:onboarding&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { analytics } = res.json();
    expect(analytics.breakdown).toBeDefined();

    const variantA = analytics.breakdown.find((b: any) => b.value === "A");
    expect(variantA.steps[0].unique_users).toBe(1);

    const variantB = analytics.breakdown.find((b: any) => b.value === "B");
    expect(variantB.steps[0].unique_users).toBe(2);
  });
});

describe("Ingest: track events dual-write to funnel_events", () => {
  it("stores experiments field on events", async () => {
    await ingest([
      {
        level: "info",
        message: "test event",
        session_id: TEST_SESSION_ID,
        user_id: "user-1",
        experiments: { onboarding: "A", pricing: "control" },
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/events?project_id=${projectId}&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    const event = res.json().events[0];
    expect(event.experiments).toEqual({ onboarding: "A", pricing: "control" });
  });

  it("dual-writes track events to funnel_events", async () => {
    await ingest([
      {
        level: "info",
        message: "track:welcome",
        session_id: TEST_SESSION_ID,
        user_id: "user-1",
      },
    ]);

    // Wait for fire-and-forget write
    await new Promise((r) => setTimeout(r, 200));

    // Create a funnel and query it to verify funnel_events has data
    await createFunnel({
      project_id: projectId,
      name: "Test",
      slug: "test",
      steps: [{ name: "Welcome", event_filter: { message: "track:welcome" } }],
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().analytics.steps[0].unique_users).toBe(1);
  });

  it("includes experiments in dual-written funnel events", async () => {
    await ingest([
      {
        level: "info",
        message: "track:welcome",
        session_id: TEST_SESSION_ID,
        user_id: "user-1",
        experiments: { onboarding: "B" },
      },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    await createFunnel({
      project_id: projectId,
      name: "Test",
      slug: "test",
      steps: [{ name: "Welcome", event_filter: { message: "track:welcome" } }],
    });

    // Query with experiment filter
    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&experiment=onboarding:B&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().analytics.steps[0].unique_users).toBe(1);

    // Query with wrong variant should return 0
    const res2 = await app.inject({
      method: "GET",
      url: `/v1/funnels/test/query?project_id=${projectId}&experiment=onboarding:A&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res2.json().analytics.steps[0].unique_users).toBe(0);
  });
});
