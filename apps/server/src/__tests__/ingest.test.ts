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
  TEST_BACKEND_CLIENT_KEY,
  TEST_ANDROID_CLIENT_KEY,
  TEST_ANDROID_BUNDLE_ID,
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

  it("includes Retry-After header on 429 response", async () => {
    const promises = [];
    for (let i = 0; i < 105; i++) {
      promises.push(
        ingest([{ level: "info", message: `Flood ${i}`, session_id: TEST_SESSION_ID }])
      );
    }
    const results = await Promise.all(promises);

    const rateLimited = results.find((r) => r.statusCode === 429)!;
    expect(rateLimited).toBeDefined();
    expect(rateLimited.headers["retry-after"]).toBe("1");
  });

  it("rate limits keys independently", async () => {
    // Drain the bucket for the default client key
    const promises = [];
    for (let i = 0; i < 105; i++) {
      promises.push(
        ingest([{ level: "info", message: `Flood ${i}`, session_id: TEST_SESSION_ID }])
      );
    }
    await Promise.all(promises);

    // A different key should still have its own full bucket
    const res = await ingest(
      [{ level: "info", message: "Backend event", session_id: TEST_SESSION_ID, environment: "backend" }],
      TEST_BACKEND_CLIENT_KEY,
      undefined as any
    );

    expect(res.statusCode).toBe(200);
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

  it("stores is_dev flag from event payload", async () => {
    const res = await ingest([
      { level: "info", message: "Dev event", session_id: TEST_SESSION_ID, is_dev: true },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });

    // Query with data_mode=all to find the event
    const eventsRes = await app.inject({
      method: "GET",
      url: "/v1/events?data_mode=all",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const events = eventsRes.json().events;
    expect(events).toHaveLength(1);
    expect(events[0].is_dev).toBe(true);
  });

  it("defaults is_dev to false when not provided", async () => {
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
    expect(events[0].is_dev).toBe(false);
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

  it("rejects gzip payload exceeding 1 MB compressed size", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": "2000000",
      },
      body: Buffer.from("irrelevant"),
    });

    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe("Compressed payload too large");
  });

  it("rejects gzip bomb (decompressed payload exceeding 1 MiB)", async () => {
    // 2 MiB of repeated data compresses to a few KiB
    const bomb = Buffer.from("x".repeat(2 * 1024 * 1024));
    const compressed = gzipSync(bomb);

    expect(compressed.length).toBeLessThan(1024 * 1024);

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

    expect(res.statusCode).toBe(413);
  });

  it("accepts gzip-compressed batch of 100 events", async () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      level: "info",
      message: `Compressed batch event ${i} with padding ${"x".repeat(100)}`,
      session_id: TEST_SESSION_ID,
      custom_attributes: { key: "value", padding: "y".repeat(200) },
    }));

    const json = JSON.stringify({ bundle_id: TEST_BUNDLE_ID, events });
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
    expect(res.json().accepted).toBe(100);
  });

  describe("environment validation against app platform", () => {
    it("apple app accepts ios, ipados, and macos environments", async () => {
      const res = await ingest([
        { level: "info", message: "iOS event", session_id: TEST_SESSION_ID, environment: "ios" },
        { level: "info", message: "iPadOS event", session_id: TEST_SESSION_ID, environment: "ipados" },
        { level: "info", message: "macOS event", session_id: TEST_SESSION_ID, environment: "macos" },
      ]);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 3, rejected: 0 });
    });

    it("apple app rejects android, web, and backend environments", async () => {
      const res = await ingest([
        { level: "info", message: "Android event", session_id: TEST_SESSION_ID, environment: "android" },
        { level: "info", message: "Web event", session_id: TEST_SESSION_ID, environment: "web" },
        { level: "info", message: "Backend event", session_id: TEST_SESSION_ID, environment: "backend" },
      ]);

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(3);
      expect(body.errors[0].message).toMatch(/environment "android" is not allowed for apple apps/);
    });

    it("backend app accepts backend environment", async () => {
      const res = await ingest(
        [{ level: "info", message: "Backend event", session_id: TEST_SESSION_ID, environment: "backend" }],
        TEST_BACKEND_CLIENT_KEY,
        undefined as any
      );

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
    });

    it("backend app rejects ios environment", async () => {
      const res = await ingest(
        [{ level: "info", message: "iOS event", session_id: TEST_SESSION_ID, environment: "ios" }],
        TEST_BACKEND_CLIENT_KEY,
        undefined as any
      );

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(1);
      expect(body.errors[0].message).toMatch(/environment "ios" is not allowed for backend apps/);
    });

    it("accepts events without environment (null/undefined)", async () => {
      const res = await ingest([
        { level: "info", message: "No env event", session_id: TEST_SESSION_ID },
      ]);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
    });

    it("rejects mismatched environment while accepting valid ones in same batch", async () => {
      const res = await ingest([
        { level: "info", message: "Valid iOS", session_id: TEST_SESSION_ID, environment: "ios" },
        { level: "info", message: "Invalid Android", session_id: TEST_SESSION_ID, environment: "android" },
        { level: "info", message: "No environment", session_id: TEST_SESSION_ID },
      ]);

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(2);
      expect(body.rejected).toBe(1);
    });

    // --- android platform ---

    it("android app accepts android environment", async () => {
      const res = await ingest(
        [{ level: "info", message: "Android event", session_id: TEST_SESSION_ID, environment: "android" }],
        TEST_ANDROID_CLIENT_KEY,
        TEST_ANDROID_BUNDLE_ID
      );

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
    });

    it("android app rejects ios, ipados, macos, web, and backend environments", async () => {
      const res = await ingest(
        [
          { level: "info", message: "iOS event", session_id: TEST_SESSION_ID, environment: "ios" },
          { level: "info", message: "iPadOS event", session_id: TEST_SESSION_ID, environment: "ipados" },
          { level: "info", message: "macOS event", session_id: TEST_SESSION_ID, environment: "macos" },
          { level: "info", message: "Web event", session_id: TEST_SESSION_ID, environment: "web" },
          { level: "info", message: "Backend event", session_id: TEST_SESSION_ID, environment: "backend" },
        ],
        TEST_ANDROID_CLIENT_KEY,
        TEST_ANDROID_BUNDLE_ID
      );

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(5);
      expect(body.errors[0].message).toMatch(/environment "ios" is not allowed for android apps/);
      expect(body.errors[1].message).toMatch(/environment "ipados" is not allowed for android apps/);
      expect(body.errors[2].message).toMatch(/environment "macos" is not allowed for android apps/);
      expect(body.errors[3].message).toMatch(/environment "web" is not allowed for android apps/);
      expect(body.errors[4].message).toMatch(/environment "backend" is not allowed for android apps/);
    });

    it("android app accepts events without environment", async () => {
      const res = await ingest(
        [{ level: "info", message: "No env", session_id: TEST_SESSION_ID }],
        TEST_ANDROID_CLIENT_KEY,
        TEST_ANDROID_BUNDLE_ID
      );

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
    });

    it("android app rejects mismatched environment while accepting valid ones", async () => {
      const res = await ingest(
        [
          { level: "info", message: "Valid Android", session_id: TEST_SESSION_ID, environment: "android" },
          { level: "info", message: "Invalid iOS", session_id: TEST_SESSION_ID, environment: "ios" },
          { level: "info", message: "No environment", session_id: TEST_SESSION_ID },
        ],
        TEST_ANDROID_CLIENT_KEY,
        TEST_ANDROID_BUNDLE_ID
      );

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(2);
      expect(body.rejected).toBe(1);
    });

    it("android app validates bundle_id", async () => {
      const res = await ingest(
        [{ level: "info", message: "test", session_id: TEST_SESSION_ID, environment: "android" }],
        TEST_ANDROID_CLIENT_KEY,
        "com.wrong.bundle"
      );

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/bundle_id/);
    });

    it("backend app rejects all non-backend environments", async () => {
      for (const env of ["ios", "ipados", "macos", "android", "web"]) {
        const res = await ingest(
          [{ level: "info", message: `${env} event`, session_id: TEST_SESSION_ID, environment: env }],
          TEST_BACKEND_CLIENT_KEY,
          undefined as any
        );
        expect(res.json().rejected).toBe(1);
        expect(res.json().errors[0].message).toMatch(new RegExp(`environment "${env}" is not allowed for backend apps`));
      }
    });

    it("backend app accepts batch of backend events", async () => {
      const events = Array.from({ length: 10 }, (_, i) => ({
        level: "info",
        message: `Backend batch ${i}`,
        session_id: TEST_SESSION_ID,
        environment: "backend",
      }));

      const res = await ingest(events, TEST_BACKEND_CLIENT_KEY, undefined as any);
      expect(res.statusCode).toBe(200);
      expect(res.json().accepted).toBe(10);
    });
  });
});
