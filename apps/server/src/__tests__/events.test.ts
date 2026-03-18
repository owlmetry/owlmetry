import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
  TEST_USER,
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

async function ingestEvents(events: any[]) {
  await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: { bundle_id: TEST_BUNDLE_ID, events },
  });
}

function queryEvents(params: Record<string, string> = {}, key = TEST_AGENT_KEY) {
  const qs = new URLSearchParams(params).toString();
  return app.inject({
    method: "GET",
    url: `/v1/events${qs ? `?${qs}` : ""}`,
    headers: { authorization: `Bearer ${key}` },
  });
}

describe("GET /v1/events", () => {
  it("returns ingested events", async () => {
    await ingestEvents([
      { level: "info", message: "Event 1", session_id: TEST_SESSION_ID },
      { level: "error", message: "Event 2", session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(2);
    expect(body.has_more).toBe(false);
    expect(body.cursor).toBeNull();
  });

  it("filters by level", async () => {
    await ingestEvents([
      { level: "info", message: "Info event", session_id: TEST_SESSION_ID },
      { level: "error", message: "Error event", session_id: TEST_SESSION_ID },
      { level: "error", message: "Another error", session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents({ level: "error" });
    const body = res.json();
    expect(body.events).toHaveLength(2);
    expect(body.events.every((e: any) => e.level === "error")).toBe(true);
  });

  it("filters by user_id", async () => {
    await ingestEvents([
      { level: "info", message: "User A", user_id: "user-a", session_id: TEST_SESSION_ID },
      { level: "info", message: "User B", user_id: "user-b", session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents({ user_id: "user-a" });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].user_id).toBe("user-a");
  });

  it("filters by screen_name", async () => {
    await ingestEvents([
      { level: "info", message: "Test", screen_name: "AppDelegate", session_id: TEST_SESSION_ID },
      { level: "info", message: "Test", screen_name: "ViewController", session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents({ screen_name: "AppDelegate" });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].screen_name).toBe("AppDelegate");
  });

  it("filters by time range", async () => {
    const old = new Date("2026-03-01T00:00:00Z").toISOString();
    const recent = new Date().toISOString();

    await ingestEvents([
      { level: "info", message: "Old event", timestamp: old, session_id: TEST_SESSION_ID },
      { level: "info", message: "Recent event", timestamp: recent, session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents({ since: "2026-03-10T00:00:00Z" });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("Recent event");
  });

  it("paginates with cursor", async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      level: "info" as const,
      message: `Event ${i}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      session_id: TEST_SESSION_ID,
    }));
    await ingestEvents(events);

    const page1 = await queryEvents({ limit: "2" });
    const body1 = page1.json();
    expect(body1.events).toHaveLength(2);
    expect(body1.has_more).toBe(true);
    expect(body1.cursor).toBeDefined();

    const page2 = await queryEvents({ limit: "2", cursor: body1.cursor });
    const body2 = page2.json();
    expect(body2.events).toHaveLength(2);

    // No overlap between pages
    const ids1 = body1.events.map((e: any) => e.id);
    const ids2 = body2.events.map((e: any) => e.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });

  it("excludes debug events by default", async () => {
    await ingestEvents([
      { level: "info", message: "Production event", session_id: TEST_SESSION_ID },
      { level: "info", message: "Debug event", session_id: TEST_SESSION_ID, is_debug: true },
    ]);

    const res = await queryEvents();
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("Production event");
  });

  it("includes debug events when include_debug=true", async () => {
    await ingestEvents([
      { level: "info", message: "Production event", session_id: TEST_SESSION_ID },
      { level: "info", message: "Debug event", session_id: TEST_SESSION_ID, is_debug: true },
    ]);

    const res = await queryEvents({ include_debug: "true" });
    const body = res.json();
    expect(body.events).toHaveLength(2);
  });

  it("returns empty array when no events match", async () => {
    const res = await queryEvents({ level: "warn" });
    const body = res.json();
    expect(body.events).toHaveLength(0);
    expect(body.has_more).toBe(false);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/events",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects client key (no events:read permission)", async () => {
    const res = await queryEvents({}, TEST_CLIENT_KEY);
    expect(res.statusCode).toBe(403);
  });

  it("works with JWT auth", async () => {
    await ingestEvents([{ level: "info", message: "JWT test", session_id: TEST_SESSION_ID }]);

    const token = await getToken(app);
    const res = await queryEvents({}, token);
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(1);
  });
});

describe("GET /v1/events/:id", () => {
  it("returns a single event", async () => {
    await ingestEvents([{ level: "info", message: "Find me", session_id: TEST_SESSION_ID }]);

    const listRes = await queryEvents();
    const eventId = listRes.json().events[0].id;

    const res = await app.inject({
      method: "GET",
      url: `/v1/events/${eventId}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe("Find me");
  });

  it("returns 404 for non-existent event", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
