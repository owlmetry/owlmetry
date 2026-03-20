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

describe("Metric Definitions CRUD", () => {
  it("creates a metric definition", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        project_id: projectId,
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
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${token}` },
      payload: { project_id: projectId, name: "Test", slug: "test-metric" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${token}` },
      payload: { project_id: projectId, name: "Test 2", slug: "test-metric" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("lists metric definitions for a project", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${token}` },
      payload: { project_id: projectId, name: "Metric A", slug: "metric-a" },
    });
    await app.inject({
      method: "POST",
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${token}` },
      payload: { project_id: projectId, name: "Metric B", slug: "metric-b" },
    });

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metrics?project_id=${projectId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().metrics).toHaveLength(2);
  });

  it("gets a single metric definition by slug", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${token}` },
      payload: { project_id: projectId, name: "Checkout", slug: "checkout" },
    });

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metrics/checkout?project_id=${projectId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe("checkout");
  });

  it("updates a metric definition", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${token}` },
      payload: { project_id: projectId, name: "Old Name", slug: "update-test" },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/metrics/update-test?project_id=${projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "New Name", status: "paused" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("New Name");
    expect(res.json().status).toBe("paused");
  });

  it("soft-deletes a metric definition (user-only)", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${token}` },
      payload: { project_id: projectId, name: "Delete Me", slug: "delete-me" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/metrics/delete-me?project_id=${projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);

    // Should no longer appear in list
    const listRes = await app.inject({
      method: "GET",
      url: `/v1/metrics?project_id=${projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json().metrics).toHaveLength(0);
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
      url: `/v1/metrics/photo-conversion/events?project_id=${projectId}&include_debug=true`,
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
      url: `/v1/metrics/regular-log-message/events?project_id=${projectId}&include_debug=true`,
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
    is_debug?: boolean;
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
            is_debug: attrs.is_debug,
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
    await ingestMetric(slug, "record", { environment: "android" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const iosRes = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&environment=ios`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(iosRes.statusCode).toBe(200);
    expect(iosRes.json().aggregation.total_count).toBe(2);

    const androidRes = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&environment=android`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(androidRes.json().aggregation.total_count).toBe(1);

    const allRes = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/query?project_id=${projectId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(allRes.json().aggregation.total_count).toBe(3);
  });

  it("groups query results by environment", async () => {
    const slug = "env-group-query";
    await ingestMetric(slug, "record", { environment: "ios" });
    await ingestMetric(slug, "record", { environment: "ios" });
    await ingestMetric(slug, "record", { environment: "web" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&group_by=environment`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(2);
    const iosGroup = groups.find((g: any) => g.value === "ios");
    const webGroup = groups.find((g: any) => g.value === "web");
    expect(iosGroup.total_count).toBe(2);
    expect(webGroup.total_count).toBe(1);
  });

  it("filters raw metric events by environment", async () => {
    const slug = "env-filter-events";
    await ingestMetric(slug, "record", { environment: "macos" });
    await ingestMetric(slug, "record", { environment: "backend" });
    await ingestMetric(slug, "record", { environment: "backend" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const macosRes = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/events?project_id=${projectId}&environment=macos&include_debug=true`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(macosRes.json().events).toHaveLength(1);

    const backendRes = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/events?project_id=${projectId}&environment=backend&include_debug=true`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(backendRes.json().events).toHaveLength(2);
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
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&app_version=1.0.0`,
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
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&group_by=app_version`,
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
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&device_model=${encodeURIComponent("iPhone 15")}`,
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
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&os_version=18.0`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.json().aggregation.total_count).toBe(2);
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
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&user_id=user-alice`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(aliceRes.json().aggregation.total_count).toBe(2);

    const bobRes = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&user_id=user-bob`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(bobRes.json().aggregation.total_count).toBe(1);
  });

  // --- is_debug ---

  it("filters query results by is_debug", async () => {
    const slug = "debug-filter";
    await ingestMetric(slug, "record", { is_debug: true });
    await ingestMetric(slug, "record", { is_debug: false });
    await ingestMetric(slug, "record", { is_debug: false });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const debugRes = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&is_debug=true`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(debugRes.json().aggregation.total_count).toBe(1);

    const prodRes = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&is_debug=false`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(prodRes.json().aggregation.total_count).toBe(2);
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
      url: `/v1/metrics/${slug}/events?project_id=${projectId}&phase=start&include_debug=true`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(startRes.json().events).toHaveLength(1);
    expect(startRes.json().events[0].phase).toBe("start");

    const completeRes = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/events?project_id=${projectId}&phase=complete&include_debug=true`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(completeRes.json().events).toHaveLength(1);
    expect(completeRes.json().events[0].phase).toBe("complete");

    const recordRes = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/events?project_id=${projectId}&phase=record&include_debug=true`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(recordRes.json().events).toHaveLength(1);
    expect(recordRes.json().events[0].phase).toBe("record");
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
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&group_by=time:day`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const groups = res.json().aggregation.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("time:day");
    expect(groups[0].total_count).toBe(2);
  });

  // --- invalid group_by ---

  it("rejects invalid group_by value", async () => {
    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);
    const res = await app.inject({
      method: "GET",
      url: `/v1/metrics/any-slug/query?project_id=${projectId}&group_by=invalid_field`,
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
    await ingestMetric(slug, "record", { environment: "android", app_version: "1.0.0" });
    await new Promise((r) => setTimeout(r, 200));

    const agentKey = await createAgentKey(app, token, teamId, ["metrics:read"]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/metrics/${slug}/query?project_id=${projectId}&environment=ios&app_version=1.0.0`,
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
      url: `/v1/metrics/checkout/query?project_id=${projectId}`,
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
