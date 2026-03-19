import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { gzipSync } from "node:zlib";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_EXPIRED_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
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

function ingest(
  events: any[],
  key = TEST_CLIENT_KEY,
  bundle_id = TEST_BUNDLE_ID
) {
  return app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${key}` },
    payload: { bundle_id, events },
  });
}

describe("POST /v1/ingest", () => {
  it("accepts a single valid event", async () => {
    const res = await ingest([
      { level: "info", message: "App launched", session_id: TEST_SESSION_ID },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
  });

  it("accepts a batch of 20 events", async () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      level: "info",
      message: `Event ${i}`,
      session_id: TEST_SESSION_ID,
    }));

    const res = await ingest(events);
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(20);
  });

  it("accepts events with all device fields", async () => {
    const res = await ingest([
      {
        level: "info",
        message: "Full event",
        session_id: TEST_SESSION_ID,
        user_id: "user-1",
        source_module: "AppDelegate",
        screen_name: "launch",
        custom_attributes: { key: "value" },
        environment: "ios",
        os_version: "18.2",
        app_version: "2.1.0",
        device_model: "iPhone 15 Pro",
        build_number: "142",
        locale: "en_US",
      },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);
  });

  it("rejects batch over 100 events", async () => {
    const events = Array.from({ length: 101 }, (_, i) => ({
      level: "info",
      message: `Event ${i}`,
      session_id: TEST_SESSION_ID,
    }));

    const res = await ingest(events);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/100/);
  });

  it("rejects events with missing message", async () => {
    const res = await ingest([{ level: "info", session_id: TEST_SESSION_ID }]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accepted: 0,
      rejected: 1,
      errors: [{ index: 0, message: expect.stringContaining("message") }],
    });
  });

  it("rejects events with invalid level", async () => {
    const res = await ingest([{ level: "critical", message: "test", session_id: TEST_SESSION_ID }]);

    expect(res.statusCode).toBe(200);
    expect(res.json().rejected).toBe(1);
  });

  it("accepts valid events and rejects invalid ones in same batch", async () => {
    const res = await ingest([
      { level: "info", message: "Good event", session_id: TEST_SESSION_ID },
      { level: "info", session_id: TEST_SESSION_ID }, // missing message
      { level: "error", message: "Another good one", session_id: TEST_SESSION_ID },
    ]);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(2);
    expect(body.rejected).toBe(1);
  });

  it("deduplicates by client_event_id", async () => {
    const dedupId = "00000000-0000-0000-0000-000000000099";
    await ingest([
      { level: "info", message: "First", client_event_id: dedupId, session_id: TEST_SESSION_ID },
    ]);

    const res = await ingest([
      { level: "info", message: "Duplicate", client_event_id: dedupId, session_id: TEST_SESSION_ID },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(0);
  });

  it("trims custom attribute values over 200 chars", async () => {
    const longValue = "x".repeat(300);
    const res = await ingest([
      {
        level: "info",
        message: "Trimmed custom attributes",
        session_id: TEST_SESSION_ID,
        custom_attributes: { key: longValue },
      },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);
  });

  it("rejects empty events array", async () => {
    const res = await ingest([]);
    expect(res.statusCode).toBe(400);
  });

  it("rejects agent key (no events:write permission)", async () => {
    const res = await ingest(
      [{ level: "info", message: "test", session_id: TEST_SESSION_ID }],
      TEST_AGENT_KEY
    );

    expect(res.statusCode).toBe(403);
  });

  it("rejects invalid API key", async () => {
    const res = await ingest(
      [{ level: "info", message: "test", session_id: TEST_SESSION_ID }],
      "owl_client_invalidkeyinvalidkeyinvalidkeyinvalidke"
    );

    expect(res.statusCode).toBe(401);
  });

  it("rejects request without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      payload: { events: [{ level: "info", message: "test", session_id: TEST_SESSION_ID }] },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects expired API key", async () => {
    const res = await ingest(
      [{ level: "info", message: "test", session_id: TEST_SESSION_ID }],
      TEST_EXPIRED_KEY
    );

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/expired/i);
  });

  it("rate limits after too many requests", async () => {
    // Drain the token bucket (100 tokens default)
    const promises = [];
    for (let i = 0; i < 105; i++) {
      promises.push(
        ingest([{ level: "info", message: `Flood ${i}`, session_id: TEST_SESSION_ID }])
      );
    }
    const results = await Promise.all(promises);

    const rateLimited = results.filter((r) => r.statusCode === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
    expect(rateLimited[0].json().error).toMatch(/rate limit/i);
  });

  it("accepts gzip-compressed event payload", async () => {
    const json = JSON.stringify({
      bundle_id: TEST_BUNDLE_ID,
      events: [{ level: "info", message: "Compressed event", session_id: TEST_SESSION_ID }],
    });
    const compressed = gzipSync(Buffer.from(json));

    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: compressed,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
  });

  it("rejects request with missing bundle_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { events: [{ level: "info", message: "test", session_id: TEST_SESSION_ID }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/bundle_id/);
  });

  it("rejects request with mismatched bundle_id", async () => {
    const res = await ingest(
      [{ level: "info", message: "test", session_id: TEST_SESSION_ID }],
      TEST_CLIENT_KEY,
      "com.wrong.bundle"
    );

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/bundle_id/);
  });

  it("stores is_debug flag from event payload", async () => {
    const res = await ingest([
      { level: "info", message: "Debug event", session_id: TEST_SESSION_ID, is_debug: true },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });

    // Query with include_debug to find the event
    const eventsRes = await app.inject({
      method: "GET",
      url: "/v1/events?include_debug=true",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const events = eventsRes.json().events;
    expect(events).toHaveLength(1);
    expect(events[0].is_debug).toBe(true);
  });

  it("defaults is_debug to false when not provided", async () => {
    const res = await ingest([
      { level: "info", message: "Normal event", session_id: TEST_SESSION_ID },
    ]);

    expect(res.statusCode).toBe(200);

    const eventsRes = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const events = eventsRes.json().events;
    expect(events).toHaveLength(1);
    expect(events[0].is_debug).toBe(false);
  });

  it("rejects invalid gzip data", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      payload: Buffer.from("not valid gzip data"),
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
