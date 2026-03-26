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

describe("Metric Definitions CRUD", () => {
  it("creates a metric definition", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Photo Conversion",
        slug: "photo-conversion",
        description: "Tracks photo conversions",
        aggregation_rules: { lifecycle: true },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.slug).toBe("photo-conversion");
    expect(body.name).toBe("Photo Conversion");
    expect(body.aggregation_rules).toEqual({ lifecycle: true });
  });

  it("rejects duplicate slug in same project", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Test", slug: "test-metric" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Test 2", slug: "test-metric" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("lists metric definitions for a project", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Metric A", slug: "metric-a" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Metric B", slug: "metric-b" },
    });

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().metrics).toHaveLength(2);
  });

  it("gets a single metric definition by slug", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Checkout", slug: "checkout" },
    });

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/checkout`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe("checkout");
  });

  it("returns 404 for non-existent metric by-id", async () => {
    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/metrics/by-id/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Metric not found");
  });

  it("gets a metric by UUID via by-id endpoint", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Test", slug: "test-metric" },
    });
    const metricId = createRes.json().id;

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metrics/by-id/${metricId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe("test-metric");
    expect(res.json().id).toBe(metricId);
  });

  it("updates a metric definition", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Old Name", slug: "update-test" },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/metrics/update-test`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "New Name" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("New Name");
  });

  it("soft-deletes a metric definition", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Delete Me", slug: "delete-me" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/metrics/delete-me`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);

    // Should no longer appear in list
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json().metrics).toHaveLength(0);
  });

  it("resurrects a soft-deleted metric when creating with the same slug", async () => {
    // Create and then delete
    const createRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Original", slug: "resurrect-test" },
    });
    expect(createRes.statusCode).toBe(201);
    const originalId = createRes.json().id;

    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/metrics/resurrect-test`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Recreate with same slug — should resurrect with same UUID
    const recreateRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/metrics`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Resurrected", slug: "resurrect-test" },
    });
    expect(recreateRes.statusCode).toBe(201);
    expect(recreateRes.json().id).toBe(originalId);
    expect(recreateRes.json().name).toBe("Resurrected");
  });
});

describe("Metric Dual-Write via Ingest", () => {
  it("writes metric events to metric_events table", async () => {
    const trackingId = "11111111-1111-1111-1111-111111111111";
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [
          {
            session_id: TEST_SESSION_ID,
            level: "info",
            message: "metric:photo-conversion:start",
            custom_attributes: { tracking_id: trackingId, input_format: "heic" },
          },
          {
            session_id: TEST_SESSION_ID,
            level: "info",
            message: "metric:photo-conversion:complete",
            custom_attributes: { tracking_id: trackingId, duration_ms: "1234", output_format: "jpeg" },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(2);

    // Wait for fire-and-forget dual-write
    await new Promise((r) => setTimeout(r, 200));

    // Query metric events via the raw events endpoint
    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const eventsRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/photo-conversion/events?data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(eventsRes.statusCode).toBe(200);
    const events = eventsRes.json().events;
    expect(events).toHaveLength(2);

    const start = events.find((e: any) => e.phase === "start");
    const complete = events.find((e: any) => e.phase === "complete");
    expect(start).toBeDefined();
    expect(complete).toBeDefined();
    expect(complete.duration_ms).toBe(1234);
    expect(complete.tracking_id).toBe(trackingId);
  });

  it("does not create metric event for non-metric messages", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [
          {
            session_id: TEST_SESSION_ID,
            level: "info",
            message: "Regular log message",
          },
        ],
      },
    });

    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const eventsRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/regular-log-message/events?data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(eventsRes.json().events).toHaveLength(0);
  });
});

describe("Metric Query Filters", () => {
  /** Ingest a metric event with optional attributes. */
  async function ingestMetric(slug: string, phase: string, attrs: {
    environment?: string;
    app_version?: string;
    device_model?: string;
    os_version?: string;
    user_id?: string;
    is_dev?: boolean;
    tracking_id?: string;
    duration_ms?: string;
    error?: string;
  } = {}) {
    const trackingId = attrs.tracking_id ?? crypto.randomUUID();
    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [
          {
            session_id: TEST_SESSION_ID,
            level: "info",
            message: `metric:${slug}:${phase}`,
            environment: attrs.environment,
            app_version: attrs.app_version,
            device_model: attrs.device_model,
            os_version: attrs.os_version,
            user_id: attrs.user_id,
            is_dev: attrs.is_dev,
            custom_attributes: {
              tracking_id: trackingId,
              ...(attrs.duration_ms ? { duration_ms: attrs.duration_ms } : {}),
              ...(attrs.error ? { error: attrs.error } : {}),
            },
          },
        ],
      },
    });
  }

  // --- environment ---

  it("filters query results by environment", async () => {
    const slug = "env-filter-query";
    await ingestMetric(slug, "record", { environment: "ios" });
    await ingestMetric(slug, "record", { environment: "ios" });
    await ingestMetric(slug, "record", { environment: "macos" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const iosRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?environment=ios`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(iosRes.statusCode).toBe(200);
    expect(iosRes.json().aggregation.total_count).toBe(2);

    const macosRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?environment=macos`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(macosRes.json().aggregation.total_count).toBe(1);

    const allRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(allRes.json().aggregation.total_count).toBe(3);
  });

  it("groups query results by environment", async () => {
    const slug = "env-group-query";
    await ingestMetric(slug, "record", { environment: "ios" });
    await ingestMetric(slug, "record", { environment: "ios" });
    await ingestMetric(slug, "record", { environment: "ipados" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?group_by=environment`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(2);
    const iosGroup = groups.find((g: any) => g.value === "ios");
    const ipadosGroup = groups.find((g: any) => g.value === "ipados");
    expect(iosGroup.total_count).toBe(2);
    expect(ipadosGroup.total_count).toBe(1);
  });

  it("filters raw metric events by environment", async () => {
    const slug = "env-filter-events";
    await ingestMetric(slug, "record", { environment: "macos" });
    await ingestMetric(slug, "record", { environment: "ipados" });
    await ingestMetric(slug, "record", { environment: "ipados" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const macosRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/events?environment=macos&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(macosRes.json().events).toHaveLength(1);

    const ipadosRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/events?environment=ipados&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(ipadosRes.json().events).toHaveLength(2);
  });

  // --- app_version ---

  it("filters query results by app_version", async () => {
    const slug = "ver-filter";
    await ingestMetric(slug, "record", { app_version: "1.0.0" });
    await ingestMetric(slug, "record", { app_version: "1.0.0" });
    await ingestMetric(slug, "record", { app_version: "2.0.0" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?app_version=1.0.0`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().aggregation.total_count).toBe(2);
  });

  it("groups query results by app_version", async () => {
    const slug = "ver-group";
    await ingestMetric(slug, "record", { app_version: "1.0.0" });
    await ingestMetric(slug, "record", { app_version: "2.0.0" });
    await ingestMetric(slug, "record", { app_version: "2.0.0" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?group_by=app_version`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(2);
    const v1 = groups.find((g: any) => g.value === "1.0.0");
    const v2 = groups.find((g: any) => g.value === "2.0.0");
    expect(v1.total_count).toBe(1);
    expect(v2.total_count).toBe(2);
  });

  // --- device_model ---

  it("filters query results by device_model", async () => {
    const slug = "device-filter";
    await ingestMetric(slug, "record", { device_model: "iPhone 15" });
    await ingestMetric(slug, "record", { device_model: "iPhone 15" });
    await ingestMetric(slug, "record", { device_model: "Pixel 8" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?device_model=${encodeURIComponent("iPhone 15")}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.json().aggregation.total_count).toBe(2);
  });

  // --- os_version ---

  it("filters query results by os_version", async () => {
    const slug = "os-filter";
    await ingestMetric(slug, "record", { os_version: "17.4" });
    await ingestMetric(slug, "record", { os_version: "18.0" });
    await ingestMetric(slug, "record", { os_version: "18.0" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?os_version=18.0`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.json().aggregation.total_count).toBe(2);
  });

  // --- device_model group_by ---

  it("groups query results by device_model", async () => {
    const slug = "device-group";
    await ingestMetric(slug, "record", { device_model: "iPhone 15" });
    await ingestMetric(slug, "record", { device_model: "iPhone 15" });
    await ingestMetric(slug, "record", { device_model: "Pixel 8" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?group_by=device_model`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(2);
    const iphone = groups.find((g: any) => g.value === "iPhone 15");
    const pixel = groups.find((g: any) => g.value === "Pixel 8");
    expect(iphone.total_count).toBe(2);
    expect(pixel.total_count).toBe(1);
  });

  // --- os_version group_by ---

  it("groups query results by os_version", async () => {
    const slug = "os-group";
    await ingestMetric(slug, "record", { os_version: "17.4" });
    await ingestMetric(slug, "record", { os_version: "18.0" });
    await ingestMetric(slug, "record", { os_version: "18.0" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?group_by=os_version`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(2);
    const v174 = groups.find((g: any) => g.value === "17.4");
    const v180 = groups.find((g: any) => g.value === "18.0");
    expect(v174.total_count).toBe(1);
    expect(v180.total_count).toBe(2);
  });

  // --- user_id ---

  it("filters query results by user_id", async () => {
    const slug = "user-filter";
    await ingestMetric(slug, "record", { user_id: "user-alice" });
    await ingestMetric(slug, "record", { user_id: "user-alice" });
    await ingestMetric(slug, "record", { user_id: "user-bob" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const aliceRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?user_id=user-alice`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(aliceRes.json().aggregation.total_count).toBe(2);

    const bobRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?user_id=user-bob`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(bobRes.json().aggregation.total_count).toBe(1);
  });

  // --- data_mode ---

  it("filters query results by data_mode", async () => {
    const slug = "dev-filter";
    await ingestMetric(slug, "record", { is_dev: true });
    await ingestMetric(slug, "record", { is_dev: false });
    await ingestMetric(slug, "record", { is_dev: false });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const devRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?data_mode=development`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(devRes.json().aggregation.total_count).toBe(1);

    const prodRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?data_mode=production`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(prodRes.json().aggregation.total_count).toBe(2);

    const allRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(allRes.json().aggregation.total_count).toBe(3);
  });

  // --- until filter ---

  it("filters query results by until timestamp", async () => {
    const slug = "until-filter-query";
    const now = Date.now();
    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [
          { session_id: TEST_SESSION_ID, level: "info", message: `metric:${slug}:record`, timestamp: new Date(now - 7200000).toISOString(), custom_attributes: { tracking_id: crypto.randomUUID() } },
          { session_id: TEST_SESSION_ID, level: "info", message: `metric:${slug}:record`, timestamp: new Date(now - 100).toISOString(), custom_attributes: { tracking_id: crypto.randomUUID() } },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?until=${new Date(now - 3600000).toISOString()}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().aggregation.total_count).toBe(1);
  });

  it("filters raw metric events by until timestamp", async () => {
    const slug = "until-filter-events";
    const now = Date.now();
    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [
          { session_id: TEST_SESSION_ID, level: "info", message: `metric:${slug}:record`, timestamp: new Date(now - 7200000).toISOString(), custom_attributes: { tracking_id: crypto.randomUUID() } },
          { session_id: TEST_SESSION_ID, level: "info", message: `metric:${slug}:record`, timestamp: new Date(now - 100).toISOString(), custom_attributes: { tracking_id: crypto.randomUUID() } },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/events?until=${new Date(now - 3600000).toISOString()}&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(1);
  });

  // --- phase filter on events endpoint ---

  it("filters raw metric events by phase", async () => {
    const slug = "phase-filter";
    const tid = crypto.randomUUID();
    await ingestMetric(slug, "start", { tracking_id: tid });
    await ingestMetric(slug, "complete", { tracking_id: tid, duration_ms: "100" });
    await ingestMetric(slug, "record");
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const startRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/events?phase=start&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(startRes.json().events).toHaveLength(1);
    expect(startRes.json().events[0].phase).toBe("start");

    const completeRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/events?phase=complete&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(completeRes.json().events).toHaveLength(1);
    expect(completeRes.json().events[0].phase).toBe("complete");

    const recordRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/events?phase=record&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(recordRes.json().events).toHaveLength(1);
    expect(recordRes.json().events[0].phase).toBe("record");
  });

  // --- tracking_id filter on events endpoint ---

  it("filters raw metric events by tracking_id", async () => {
    const slug = "tid-filter";
    const targetTid = crypto.randomUUID();
    await ingestMetric(slug, "record", { tracking_id: targetTid });
    await ingestMetric(slug, "record");
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/events?tracking_id=${targetTid}&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(1);
    expect(res.json().events[0].tracking_id).toBe(targetTid);
  });

  // --- cursor pagination on events endpoint ---

  it("paginates raw metric events with cursor", async () => {
    const slug = "cursor-paginate";
    const now = Date.now();
    // Space events apart so timestamp-based cursor advances
    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [
          { session_id: TEST_SESSION_ID, level: "info", message: `metric:${slug}:record`, timestamp: new Date(now - 30000).toISOString(), custom_attributes: { tracking_id: crypto.randomUUID() } },
          { session_id: TEST_SESSION_ID, level: "info", message: `metric:${slug}:record`, timestamp: new Date(now - 20000).toISOString(), custom_attributes: { tracking_id: crypto.randomUUID() } },
          { session_id: TEST_SESSION_ID, level: "info", message: `metric:${slug}:record`, timestamp: new Date(now - 10000).toISOString(), custom_attributes: { tracking_id: crypto.randomUUID() } },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    // Page 1 — limit=2, so we get 2 events and cursor advances past the 2nd
    const page1 = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/events?limit=2&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json();
    expect(p1.events).toHaveLength(2);
    expect(p1.has_more).toBe(true);
    expect(p1.cursor).toBeDefined();

    // Page 2 — should return remaining event(s)
    const page2 = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/events?limit=2&cursor=${p1.cursor}&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(page2.statusCode).toBe(200);
    const p2 = page2.json();
    expect(p2.events.length).toBeGreaterThanOrEqual(1);
  });

  // --- group_by time:day ---

  it("groups query results by time:day", async () => {
    const slug = "time-group";
    // All events are ingested ~now, so they land in the same day bucket
    await ingestMetric(slug, "record");
    await ingestMetric(slug, "record");
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?group_by=time:day`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("time:day");
    expect(groups[0].total_count).toBe(2);
  });

  // --- group_by time:hour ---

  it("groups query results by time:hour", async () => {
    const slug = "time-hour-group";
    await ingestMetric(slug, "record");
    await ingestMetric(slug, "record");
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?group_by=time:hour`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("time:hour");
    expect(groups[0].total_count).toBe(2);
  });

  // --- group_by time:week ---

  it("groups query results by time:week", async () => {
    const slug = "time-week-group";
    await ingestMetric(slug, "record");
    await ingestMetric(slug, "record");
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?group_by=time:week`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("time:week");
    expect(groups[0].total_count).toBe(2);
  });

  // --- invalid group_by ---

  it("rejects invalid group_by value", async () => {
    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/any-slug/query?group_by=invalid_field`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid group_by");
  });

  // --- combined filters ---

  it("combines multiple filters", async () => {
    const slug = "multi-filter";
    await ingestMetric(slug, "record", { environment: "ios", app_version: "1.0.0" });
    await ingestMetric(slug, "record", { environment: "ios", app_version: "2.0.0" });
    await ingestMetric(slug, "record", { environment: "macos", app_version: "1.0.0" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?environment=ios&app_version=1.0.0`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.json().aggregation.total_count).toBe(1);
  });
});

describe("Metric Aggregation", () => {
  it("returns aggregation results", async () => {
    const trackingId1 = "22222222-2222-2222-2222-222222222221";
    const trackingId2 = "22222222-2222-2222-2222-222222222222";

    // Ingest lifecycle events
    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [
          { session_id: TEST_SESSION_ID, level: "info", message: "metric:checkout:start", custom_attributes: { tracking_id: trackingId1 } },
          { session_id: TEST_SESSION_ID, level: "info", message: "metric:checkout:complete", custom_attributes: { tracking_id: trackingId1, duration_ms: "500" } },
          { session_id: TEST_SESSION_ID, level: "error", message: "metric:checkout:start", custom_attributes: { tracking_id: trackingId2 } },
          { session_id: TEST_SESSION_ID, level: "error", message: "metric:checkout:fail", custom_attributes: { tracking_id: trackingId2, duration_ms: "200", error: "payment_failed" } },
        ],
      },
    });

    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/checkout/query`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const { aggregation } = res.json();
    expect(aggregation.total_count).toBe(4);
    expect(aggregation.start_count).toBe(2);
    expect(aggregation.complete_count).toBe(1);
    expect(aggregation.fail_count).toBe(1);
    expect(aggregation.success_rate).toBe(50);
    expect(aggregation.duration_avg_ms).toBeDefined();
    expect(aggregation.error_breakdown).toHaveLength(1);
    expect(aggregation.error_breakdown[0].error).toBe("payment_failed");
  });
});

// ─── Cross-platform metric tests ─────────────────────────────────────────────

describe("Metric Cross-Platform Environment", () => {
  /** Ingest a metric event targeting a specific platform's app. */
  async function ingestMetricForPlatform(
    platform: "apple" | "backend" | "android",
    slug: string,
    phase: string,
    attrs: {
      environment?: string;
      app_version?: string;
      user_id?: string;
      is_dev?: boolean;
      tracking_id?: string;
      duration_ms?: string;
      error?: string;
    } = {}
  ) {
    const keyMap = {
      apple: { key: TEST_CLIENT_KEY, bundle_id: TEST_BUNDLE_ID },
      backend: { key: TEST_BACKEND_CLIENT_KEY, bundle_id: undefined },
      android: { key: TEST_ANDROID_CLIENT_KEY, bundle_id: TEST_ANDROID_BUNDLE_ID },
    };
    const { key, bundle_id } = keyMap[platform];
    const trackingId = attrs.tracking_id ?? crypto.randomUUID();
    return app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${key}` },
      payload: {
        bundle_id,
        events: [
          {
            session_id: TEST_SESSION_ID,
            level: "info",
            message: `metric:${slug}:${phase}`,
            environment: attrs.environment,
            app_version: attrs.app_version,
            user_id: attrs.user_id,
            is_dev: attrs.is_dev,
            custom_attributes: {
              tracking_id: trackingId,
              ...(attrs.duration_ms ? { duration_ms: attrs.duration_ms } : {}),
              ...(attrs.error ? { error: attrs.error } : {}),
            },
          },
        ],
      },
    });
  }

  // --- backend platform ---

  it("ingests metric events via backend app with backend environment", async () => {
    const slug = "backend-metric";
    const res = await ingestMetricForPlatform("backend", slug, "record", { environment: "backend" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });

    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const eventsRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/metrics/${slug}/events?data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(eventsRes.json().events).toHaveLength(1);
    expect(eventsRes.json().events[0].environment).toBe("backend");
  });

  it("filters backend metric events by environment", async () => {
    const slug = "backend-env-filter";
    await ingestMetricForPlatform("backend", slug, "record", { environment: "backend" });
    await ingestMetricForPlatform("backend", slug, "record", { environment: "backend" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const backendRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/metrics/${slug}/events?environment=backend&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(backendRes.json().events).toHaveLength(2);

    // ios should return nothing for a backend project
    const iosRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/metrics/${slug}/events?environment=ios&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(iosRes.json().events).toHaveLength(0);
  });

  it("queries backend metric aggregation", async () => {
    const slug = "backend-agg";
    const tid1 = crypto.randomUUID();
    const tid2 = crypto.randomUUID();
    await ingestMetricForPlatform("backend", slug, "start", { tracking_id: tid1, environment: "backend" });
    await ingestMetricForPlatform("backend", slug, "complete", { tracking_id: tid1, duration_ms: "300", environment: "backend" });
    await ingestMetricForPlatform("backend", slug, "start", { tracking_id: tid2, environment: "backend" });
    await ingestMetricForPlatform("backend", slug, "fail", { tracking_id: tid2, duration_ms: "100", error: "timeout", environment: "backend" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/metrics/${slug}/query`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const { aggregation } = res.json();
    expect(aggregation.total_count).toBe(4);
    expect(aggregation.start_count).toBe(2);
    expect(aggregation.complete_count).toBe(1);
    expect(aggregation.fail_count).toBe(1);
    expect(aggregation.success_rate).toBe(50);
    expect(aggregation.error_breakdown).toHaveLength(1);
    expect(aggregation.error_breakdown[0].error).toBe("timeout");
  });

  it("backend app rejects non-backend environments for metrics", async () => {
    const slug = "backend-reject";
    const res = await ingestMetricForPlatform("backend", slug, "record", { environment: "ios" });
    expect(res.statusCode).toBe(200);
    expect(res.json().rejected).toBe(1);
    expect(res.json().errors[0].message).toMatch(/environment "ios" is not allowed for backend apps/);
  });

  // --- android platform ---

  it("ingests metric events via android app with android environment", async () => {
    const slug = "android-metric";
    const res = await ingestMetricForPlatform("android", slug, "record", { environment: "android" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });

    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const eventsRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/metrics/${slug}/events?data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(eventsRes.json().events).toHaveLength(1);
    expect(eventsRes.json().events[0].environment).toBe("android");
  });

  it("filters android metric events by environment", async () => {
    const slug = "android-env-filter";
    await ingestMetricForPlatform("android", slug, "record", { environment: "android" });
    await ingestMetricForPlatform("android", slug, "record", { environment: "android" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const androidRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/metrics/${slug}/events?environment=android&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(androidRes.json().events).toHaveLength(2);

    // ios should return nothing for an android project
    const iosRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/metrics/${slug}/events?environment=ios&data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(iosRes.json().events).toHaveLength(0);
  });

  it("queries android metric aggregation with lifecycle phases", async () => {
    const slug = "android-lifecycle";
    const tid = crypto.randomUUID();
    await ingestMetricForPlatform("android", slug, "start", { tracking_id: tid, environment: "android" });
    await ingestMetricForPlatform("android", slug, "complete", { tracking_id: tid, duration_ms: "750", environment: "android" });
    await ingestMetricForPlatform("android", slug, "record", { environment: "android" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/metrics/${slug}/query`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const { aggregation } = res.json();
    expect(aggregation.total_count).toBe(3);
    expect(aggregation.start_count).toBe(1);
    expect(aggregation.complete_count).toBe(1);
    expect(aggregation.record_count).toBe(1);
    expect(aggregation.success_rate).toBe(100);
  });

  it("android app rejects non-android environments for metrics", async () => {
    const slug = "android-reject";
    for (const env of ["ios", "ipados", "macos", "web", "backend"]) {
      const res = await ingestMetricForPlatform("android", slug, "record", { environment: env });
      expect(res.statusCode).toBe(200);
      expect(res.json().rejected).toBe(1);
      expect(res.json().errors[0].message).toMatch(new RegExp(`environment "${env}" is not allowed for android apps`));
    }
  });

  it("groups android metric events by app_version", async () => {
    const slug = "android-ver-group";
    await ingestMetricForPlatform("android", slug, "record", { environment: "android", app_version: "1.0.0" });
    await ingestMetricForPlatform("android", slug, "record", { environment: "android", app_version: "1.0.0" });
    await ingestMetricForPlatform("android", slug, "record", { environment: "android", app_version: "2.0.0" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/metrics/${slug}/query?group_by=app_version`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(2);
    const v1 = groups.find((g: any) => g.value === "1.0.0");
    const v2 = groups.find((g: any) => g.value === "2.0.0");
    expect(v1.total_count).toBe(2);
    expect(v2.total_count).toBe(1);
  });

  it("combines environment and app_version filters for android metrics", async () => {
    const slug = "android-combo";
    await ingestMetricForPlatform("android", slug, "record", { environment: "android", app_version: "1.0.0" });
    await ingestMetricForPlatform("android", slug, "record", { environment: "android", app_version: "2.0.0" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/metrics/${slug}/query?environment=android&app_version=1.0.0`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.json().aggregation.total_count).toBe(1);
  });

  it("data_mode filter works for backend metrics", async () => {
    const slug = "backend-data-mode";
    await ingestMetricForPlatform("backend", slug, "record", { environment: "backend", is_dev: true });
    await ingestMetricForPlatform("backend", slug, "record", { environment: "backend", is_dev: false });
    await ingestMetricForPlatform("backend", slug, "record", { environment: "backend", is_dev: false });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const devRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/metrics/${slug}/query?data_mode=development`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(devRes.json().aggregation.total_count).toBe(1);

    const prodRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/metrics/${slug}/query?data_mode=production`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(prodRes.json().aggregation.total_count).toBe(2);

    const allRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${backendProjectId}/metrics/${slug}/query?data_mode=all`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(allRes.json().aggregation.total_count).toBe(3);
  });

  it("groups query results by app_id", async () => {
    const slug = "app-id-group";
    await ingestMetricForPlatform("apple", slug, "record", { environment: "ios" });
    await ingestMetricForPlatform("apple", slug, "record", { environment: "ios" });
    await ingestMetricForPlatform("android", slug, "record", { environment: "android" });
    await new Promise((r) => setTimeout(r, 200));

    // Query apple project — should only see the 2 apple app events
    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/metrics/${slug}/query?group_by=app_id`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].total_count).toBe(2);
  });

  it("data_mode filter works for android metrics", async () => {
    const slug = "android-data-mode";
    await ingestMetricForPlatform("android", slug, "record", { environment: "android", is_dev: true });
    await ingestMetricForPlatform("android", slug, "record", { environment: "android", is_dev: false });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const devRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/metrics/${slug}/query?data_mode=development`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(devRes.json().aggregation.total_count).toBe(1);

    const prodRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${androidProjectId}/metrics/${slug}/query?data_mode=production`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(prodRes.json().aggregation.total_count).toBe(1);
  });
});
