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
    payload: { events },
  });
}

describe("POST /v1/ingest", () => {
  it("accepts a single valid event", async () => {
    const res = await ingest([
      { level: "info", body: "App launched" },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
  });

  it("accepts a batch of 20 events", async () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      level: "info",
      body: `Event ${i}`,
    }));

    const res = await ingest(events);
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(20);
  });

  it("accepts events with all device fields", async () => {
    const res = await ingest([
      {
        level: "info",
        body: "Full event",
        user_identifier: "user-1",
        source: "AppDelegate",
        context: "launch",
        meta: { key: "value" },
        platform: "ios",
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
      body: `Event ${i}`,
    }));

    const res = await ingest(events);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/100/);
  });

  it("rejects events with missing body", async () => {
    const res = await ingest([{ level: "info" }]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accepted: 0,
      rejected: 1,
      errors: [{ index: 0, message: expect.stringContaining("body") }],
    });
  });

  it("rejects events with invalid level", async () => {
    const res = await ingest([{ level: "critical", body: "test" }]);

    expect(res.statusCode).toBe(200);
    expect(res.json().rejected).toBe(1);
  });

  it("accepts valid events and rejects invalid ones in same batch", async () => {
    const res = await ingest([
      { level: "info", body: "Good event" },
      { level: "info" }, // missing body
      { level: "error", body: "Another good one" },
    ]);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(2);
    expect(body.rejected).toBe(1);
  });

  it("deduplicates by client_event_id", async () => {
    await ingest([
      { level: "info", body: "First", client_event_id: "evt-1" },
    ]);

    const res = await ingest([
      { level: "info", body: "Duplicate", client_event_id: "evt-1" },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(0);
  });

  it("trims metadata values over 200 chars", async () => {
    const longValue = "x".repeat(300);
    const res = await ingest([
      {
        level: "info",
        body: "Trimmed meta",
        meta: { key: longValue },
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
      [{ level: "info", body: "test" }],
      TEST_AGENT_KEY
    );

    expect(res.statusCode).toBe(403);
  });

  it("rejects invalid API key", async () => {
    const res = await ingest(
      [{ level: "info", body: "test" }],
      "owl_client_invalidkeyinvalidkeyinvalidkeyinvalidke"
    );

    expect(res.statusCode).toBe(401);
  });

  it("rejects request without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      payload: { events: [{ level: "info", body: "test" }] },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects expired API key", async () => {
    const res = await ingest(
      [{ level: "info", body: "test" }],
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
        ingest([{ level: "info", body: `Flood ${i}` }])
      );
    }
    const results = await Promise.all(promises);

    const rateLimited = results.filter((r) => r.statusCode === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
    expect(rateLimited[0].json().error).toMatch(/rate limit/i);
  });

  it("accepts gzip-compressed event payload", async () => {
    const json = JSON.stringify({
      events: [{ level: "info", body: "Compressed event" }],
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
