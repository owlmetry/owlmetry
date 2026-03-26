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
  TEST_BACKEND_CLIENT_KEY,
  TEST_ANDROID_CLIENT_KEY,
  TEST_ANDROID_BUNDLE_ID,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
} from "./setup.js";

let app: FastifyInstance;
let token: string;
let teamId: string;
let projectId: string;
let appId: string;
let backendProjectId: string;
let androidProjectId: string;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  projectId = seed.projectId;
  appId = seed.appId;
  backendProjectId = seed.backendProjectId;
  androidProjectId = seed.androidProjectId;
  const auth = await getTokenAndTeamId(app);
  token = auth.token;
  teamId = auth.teamId;
});

afterAll(async () => {
  await app.close();
});

function createFunnel(payload: any, authToken = token, pId = projectId) {
  return app.inject({
    method: "POST",
    url: `/v1/projects/${pId}/funnels`,
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
  { name: "Welcome", event_filter: { step_name: "welcome" } },
  { name: "Sign Up", event_filter: { step_name: "signup" } },
  { name: "Complete Profile", event_filter: { step_name: "complete-profile" } },
];

describe("Funnel Definitions CRUD", () => {
  it("creates a funnel definition", async () => {
    const res = await createFunnel({
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
      name: "Funnel A",
      slug: "test-funnel",
      steps: ONBOARDING_STEPS,
    });

    const res = await createFunnel({
      name: "Funnel B",
      slug: "test-funnel",
      steps: ONBOARDING_STEPS,
    });

    expect(res.statusCode).toBe(409);
  });

  it("rejects invalid slug", async () => {
    const res = await createFunnel({
      name: "Test",
      slug: "Invalid Slug!",
      steps: ONBOARDING_STEPS,
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects empty steps", async () => {
    const res = await createFunnel({
      name: "Test",
      slug: "test",
      steps: [],
    });

    expect(res.statusCode).toBe(400);
  });

  it("lists funnel definitions for a project", async () => {
    await createFunnel({ name: "Funnel A", slug: "funnel-a", steps: ONBOARDING_STEPS });
    await createFunnel({ name: "Funnel B", slug: "funnel-b", steps: ONBOARDING_STEPS });

    const agentKey = await createAgentKey(app, token, teamId, ["funnels:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().funnels).toHaveLength(2);
  });

  it("gets a single funnel by slug", async () => {
    await createFunnel({ name: "Test", slug: "test-funnel", steps: ONBOARDING_STEPS });

    const agentKey = await createAgentKey(app, token, teamId, ["funnels:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test-funnel`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe("test-funnel");
  });

  it("gets a funnel by UUID via by-id endpoint", async () => {
    const createRes = await createFunnel({ name: "Test", slug: "test-funnel", steps: ONBOARDING_STEPS });
    const funnelId = createRes.json().id;

    const agentKey = await createAgentKey(app, token, teamId, ["funnels:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/funnels/by-id/${funnelId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe("test-funnel");
    expect(res.json().id).toBe(funnelId);
  });

  it("updates a funnel definition", async () => {
    await createFunnel({ name: "Original", slug: "test-funnel", steps: ONBOARDING_STEPS });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/funnels/test-funnel`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Updated Name", description: "New description" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Name");
    expect(res.json().description).toBe("New description");
  });

  it("soft deletes a funnel", async () => {
    await createFunnel({ name: "To Delete", slug: "to-delete", steps: ONBOARDING_STEPS });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/funnels/to-delete`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);

    // Verify it's gone from listings
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json().funnels).toHaveLength(0);
  });

  it("allows agent key to delete funnels", async () => {
    await createFunnel({ name: "Test", slug: "test-funnel", steps: ONBOARDING_STEPS });

    const agentKey = await createAgentKey(app, token, teamId, ["funnels:read", "funnels:write"]);
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/funnels/test-funnel`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("resurrects a soft-deleted funnel when creating with the same slug", async () => {
    const createRes = await createFunnel({ name: "Original", slug: "resurrect-test", steps: ONBOARDING_STEPS });
    const originalId = createRes.json().id;

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/funnels/resurrect-test`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Recreate with same slug — should resurrect with same UUID
    const recreateRes = await createFunnel({ name: "Resurrected", slug: "resurrect-test", steps: ONBOARDING_STEPS });
    expect(recreateRes.statusCode).toBe(201);
    expect(recreateRes.json().id).toBe(originalId);
    expect(recreateRes.json().name).toBe("Resurrected");
  });

  it("returns 404 for non-existent funnel by-id", async () => {
    const agentKey = await createAgentKey(app, token, teamId, ["funnels:read"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/funnels/by-id/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Funnel not found");
  });

  it("enforces funnels:read permission", async () => {
    const agentKey = await createAgentKey(app, token, teamId, ["events:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("enforces funnels:write permission for create", async () => {
    const agentKey = await createAgentKey(app, token, teamId, ["funnels:read"]);
    const res = await createFunnel(
      { name: "Test", slug: "test", steps: ONBOARDING_STEPS },
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
    await createFunnel({ name: "Onboarding", slug: "onboarding", steps: ONBOARDING_STEPS });
    await seedFunnelEvents();

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/onboarding/query?data_mode=all`,
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
    await createFunnel({ name: "Onboarding", slug: "onboarding", steps: ONBOARDING_STEPS });
    await seedFunnelEvents();

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/onboarding/query?mode=open&data_mode=all`,
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
    await createFunnel({ name: "Empty", slug: "empty", steps: ONBOARDING_STEPS });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/empty/query?data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { analytics } = res.json();
    expect(analytics.total_users).toBe(0);
    expect(analytics.steps[0].unique_users).toBe(0);
  });

  it("filters by data_mode", async () => {
    await createFunnel({ name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    // Ingest development events
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-dev", is_dev: true, timestamp: new Date(now - 5000).toISOString() },
    ]);
    // Ingest production events
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-prod", is_dev: false, timestamp: new Date(now - 4000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    // Production only (default)
    const prodRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?data_mode=production`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(prodRes.json().analytics.steps[0].unique_users).toBe(1);

    // Development only
    const devRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?data_mode=development`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(devRes.json().analytics.steps[0].unique_users).toBe(1);

    // All
    const allRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(allRes.json().analytics.steps[0].unique_users).toBe(2);
  });

  it("filters by environment", async () => {
    await createFunnel({ name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-ios", environment: "ios", timestamp: new Date(now - 5000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-android", environment: "android", timestamp: new Date(now - 4000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?environment=ios&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().analytics.steps[0].unique_users).toBe(1);
  });

  it("filters by experiment", async () => {
    await createFunnel({ name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-a", experiments: { onboarding: "A" }, timestamp: new Date(now - 5000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-b", experiments: { onboarding: "B" }, timestamp: new Date(now - 4000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?experiment=onboarding:A&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().analytics.steps[0].unique_users).toBe(1);
  });

  it("filters funnel analytics by app_version", async () => {
    await createFunnel({ name: "Version Filter", slug: "ver-filter", steps: ONBOARDING_STEPS });

    const now = Date.now();
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-v1a", app_version: "1.0.0", timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-v1b", app_version: "1.0.0", timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-v2a", app_version: "2.0.0", timestamp: new Date(now - 40000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/ver-filter/query?app_version=1.0.0&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().analytics.steps[0].unique_users).toBe(2);
  });

  it("groups funnel analytics by app_version", async () => {
    await createFunnel({ name: "Version Group", slug: "ver-group", steps: ONBOARDING_STEPS });

    const now = Date.now();
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-v1a", app_version: "1.0.0", timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-v1b", app_version: "1.0.0", timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-v2a", app_version: "2.0.0", timestamp: new Date(now - 40000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/ver-group/query?group_by=app_version&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { analytics } = res.json();
    expect(analytics.breakdown).toBeDefined();
    expect(analytics.breakdown).toHaveLength(2);

    const v1 = analytics.breakdown.find((b: any) => b.value === "1.0.0");
    const v2 = analytics.breakdown.find((b: any) => b.value === "2.0.0");
    expect(v1.steps[0].unique_users).toBe(2);
    expect(v2.steps[0].unique_users).toBe(1);
  });

  it("excludes NULL user_id from analytics", async () => {
    await createFunnel({ name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    // Event without user_id
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, timestamp: new Date(now - 5000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().analytics.steps[0].unique_users).toBe(0);
  });

  it("computes correct drop-off math", async () => {
    await createFunnel({ name: "Test", slug: "test", steps: ONBOARDING_STEPS });
    await seedFunnelEvents();

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?data_mode=all`,
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
    await createFunnel({ name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-ios-1", environment: "ios", timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:signup", session_id: TEST_SESSION_ID, user_id: "user-ios-1", environment: "ios", timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-ipados-1", environment: "ipados", timestamp: new Date(now - 40000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?group_by=environment&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { analytics } = res.json();
    expect(analytics.breakdown).toBeDefined();
    expect(analytics.breakdown.length).toBeGreaterThanOrEqual(2);

    const iosGroup = analytics.breakdown.find((b: any) => b.value === "ios");
    expect(iosGroup).toBeDefined();
    expect(iosGroup.steps[0].unique_users).toBe(1);

    const ipadosGroup = analytics.breakdown.find((b: any) => b.value === "ipados");
    expect(ipadosGroup).toBeDefined();
    expect(ipadosGroup.steps[0].unique_users).toBe(1);
  });

  it("matches funnel steps by screen_name filter", async () => {
    await createFunnel({
      name: "Payment",
      slug: "payment",
      steps: [
        { name: "Pay", event_filter: { step_name: "pay", screen_name: "PaymentView" } },
      ],
    });

    const now = Date.now();
    // Matching message + matching screen_name → should count
    await ingest([
      { level: "info", message: "track:pay", session_id: TEST_SESSION_ID, user_id: "user-match", screen_name: "PaymentView", timestamp: new Date(now - 5000).toISOString() },
    ]);
    // Matching message + wrong screen_name → should NOT count
    await ingest([
      { level: "info", message: "track:pay", session_id: TEST_SESSION_ID, user_id: "user-wrong", screen_name: "HomeView", timestamp: new Date(now - 4000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/payment/query?data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().analytics.steps[0].unique_users).toBe(1);
  });

  it("returns empty result for invalid group_by value", async () => {
    await createFunnel({ name: "Test", slug: "test-gb", steps: ONBOARDING_STEPS });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test-gb/query?group_by=invalid_value&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { analytics } = res.json();
    expect(analytics.total_users).toBe(0);
    expect(analytics.steps).toEqual([]);
    expect(analytics.breakdown).toEqual([]);
  });

  it("groups by experiment variant", async () => {
    await createFunnel({ name: "Test", slug: "test", steps: ONBOARDING_STEPS });

    const now = Date.now();
    await ingest([
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-a1", experiments: { onboarding: "A" }, timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-b1", experiments: { onboarding: "B" }, timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:welcome", session_id: TEST_SESSION_ID, user_id: "user-b2", experiments: { onboarding: "B" }, timestamp: new Date(now - 40000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?group_by=experiment:onboarding&data_mode=all`,
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
      name: "Test",
      slug: "test",
      steps: [{ name: "Welcome", event_filter: { step_name: "welcome" } }],
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?data_mode=all`,
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
      name: "Test",
      slug: "test",
      steps: [{ name: "Welcome", event_filter: { step_name: "welcome" } }],
    });

    // Query with experiment filter
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?experiment=onboarding:B&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().analytics.steps[0].unique_users).toBe(1);

    // Query with wrong variant should return 0
    const res2 = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/funnels/test/query?experiment=onboarding:A&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res2.json().analytics.steps[0].unique_users).toBe(0);
  });
});

// ─── Cross-platform funnel tests ─────────────────────────────────────────────

describe("Funnel Cross-Platform Environment", () => {
  const STEPS = [
    { name: "Landing", event_filter: { step_name: "landing" } },
    { name: "Signup", event_filter: { step_name: "signup" } },
  ];

  function ingestForPlatform(platform: "apple" | "backend" | "android", events: any[]) {
    const keyMap = {
      apple: { key: TEST_CLIENT_KEY, bundle_id: TEST_BUNDLE_ID },
      backend: { key: TEST_BACKEND_CLIENT_KEY, bundle_id: undefined },
      android: { key: TEST_ANDROID_CLIENT_KEY, bundle_id: TEST_ANDROID_BUNDLE_ID },
    };
    const { key, bundle_id } = keyMap[platform];
    return app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${key}` },
      payload: { bundle_id, events },
    });
  }

  // --- backend platform ---

  it("tracks funnel steps ingested via backend app", async () => {
    await createFunnel({ name: "Backend Funnel", slug: "backend-funnel", steps: STEPS }, token, backendProjectId);

    const now = Date.now();
    await ingestForPlatform("backend", [
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "be-user-1", environment: "backend", timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:signup", session_id: TEST_SESSION_ID, user_id: "be-user-1", environment: "backend", timestamp: new Date(now - 50000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/funnels/backend-funnel/query?data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { steps } = res.json().analytics;
    expect(steps[0].unique_users).toBe(1);
    expect(steps[1].unique_users).toBe(1);
  });

  it("backend funnel filters by data_mode", async () => {
    await createFunnel({ name: "Backend DM", slug: "backend-dm", steps: STEPS }, token, backendProjectId);

    const now = Date.now();
    await ingestForPlatform("backend", [
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "dev-user", environment: "backend", is_dev: true, timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "prod-user", environment: "backend", is_dev: false, timestamp: new Date(now - 50000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const prodRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/funnels/backend-dm/query?data_mode=production`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(prodRes.json().analytics.steps[0].unique_users).toBe(1);

    const devRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/funnels/backend-dm/query?data_mode=development`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(devRes.json().analytics.steps[0].unique_users).toBe(1);

    const allRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/funnels/backend-dm/query?data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(allRes.json().analytics.steps[0].unique_users).toBe(2);
  });

  it("backend funnel rejects non-backend environment events", async () => {
    const res = await ingestForPlatform("backend", [
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "u1", environment: "ios" },
    ]);
    expect(res.json().rejected).toBe(1);
    expect(res.json().errors[0].message).toMatch(/not allowed for backend apps/);
  });

  // --- android platform ---

  it("tracks funnel steps ingested via android app", async () => {
    await createFunnel({ name: "Android Funnel", slug: "android-funnel", steps: STEPS }, token, androidProjectId);

    const now = Date.now();
    await ingestForPlatform("android", [
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "android-user-1", environment: "android", timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:signup", session_id: TEST_SESSION_ID, user_id: "android-user-1", environment: "android", timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "android-user-2", environment: "android", timestamp: new Date(now - 40000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/funnels/android-funnel/query?data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const { steps } = res.json().analytics;
    expect(steps[0].unique_users).toBe(2);
    expect(steps[1].unique_users).toBe(1);
    expect(steps[1].drop_off_count).toBe(1);
  });

  it("android funnel computes correct drop-off math", async () => {
    await createFunnel({ name: "Android Drop", slug: "android-drop", steps: STEPS }, token, androidProjectId);

    const now = Date.now();
    await ingestForPlatform("android", [
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "u1", environment: "android", timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "u2", environment: "android", timestamp: new Date(now - 55000).toISOString() },
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "u3", environment: "android", timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:signup", session_id: TEST_SESSION_ID, user_id: "u1", environment: "android", timestamp: new Date(now - 40000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/funnels/android-drop/query?data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    const { steps } = res.json().analytics;
    expect(steps[0].unique_users).toBe(3);
    expect(steps[0].drop_off_count).toBe(0);
    expect(steps[1].unique_users).toBe(1);
    expect(steps[1].drop_off_count).toBe(2);
  });

  it("android funnel filters by data_mode", async () => {
    await createFunnel({ name: "Android DM", slug: "android-dm", steps: STEPS }, token, androidProjectId);

    const now = Date.now();
    await ingestForPlatform("android", [
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "dev-user", environment: "android", is_dev: true, timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "prod-user-1", environment: "android", is_dev: false, timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "prod-user-2", environment: "android", is_dev: false, timestamp: new Date(now - 40000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const prodRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/funnels/android-dm/query?data_mode=production`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(prodRes.json().analytics.steps[0].unique_users).toBe(2);

    const devRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/funnels/android-dm/query?data_mode=development`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(devRes.json().analytics.steps[0].unique_users).toBe(1);
  });

  it("android funnel rejects non-android environment events", async () => {
    for (const env of ["ios", "ipados", "macos", "web", "backend"]) {
      const res = await ingestForPlatform("android", [
        { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "u1", environment: env },
      ]);
      expect(res.json().rejected).toBe(1);
      expect(res.json().errors[0].message).toMatch(new RegExp(`not allowed for android apps`));
    }
  });

  it("android funnel supports experiment grouping", async () => {
    await createFunnel({ name: "Android Exp", slug: "android-exp", steps: STEPS }, token, androidProjectId);

    const now = Date.now();
    await ingestForPlatform("android", [
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "u1", environment: "android", experiments: { checkout: "A" }, timestamp: new Date(now - 60000).toISOString() },
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "u2", environment: "android", experiments: { checkout: "B" }, timestamp: new Date(now - 50000).toISOString() },
      { level: "info", message: "track:landing", session_id: TEST_SESSION_ID, user_id: "u3", environment: "android", experiments: { checkout: "B" }, timestamp: new Date(now - 40000).toISOString() },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/funnels/android-exp/query?group_by=experiment:checkout&data_mode=all`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const variantA = res.json().analytics.breakdown.find((b: any) => b.value === "A");
    const variantB = res.json().analytics.breakdown.find((b: any) => b.value === "B");
    expect(variantA.steps[0].unique_users).toBe(1);
    expect(variantB.steps[0].unique_users).toBe(2);
  });
});
