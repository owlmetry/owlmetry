import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  createAgentKey,
  createUserAndGetToken,
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

  it("orders events ascending when order=asc", async () => {
    const now = Date.now();
    await ingestEvents([
      { level: "info", message: "Oldest", timestamp: new Date(now - 3000).toISOString(), session_id: TEST_SESSION_ID },
      { level: "info", message: "Middle", timestamp: new Date(now - 2000).toISOString(), session_id: TEST_SESSION_ID },
      { level: "info", message: "Newest", timestamp: new Date(now - 1000).toISOString(), session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents({ order: "asc" });
    const body = res.json();
    expect(body.events).toHaveLength(3);
    expect(body.events.map((e: any) => e.message)).toEqual(["Oldest", "Middle", "Newest"]);

    const timestamps = body.events.map((e: any) => new Date(e.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it("paginates ascending with cursor", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      level: "info" as const,
      message: `Event ${i}`,
      timestamp: new Date(now - (4 - i) * 1000).toISOString(),
      session_id: TEST_SESSION_ID,
    }));
    await ingestEvents(events);

    const page1 = await queryEvents({ limit: "2", order: "asc" });
    const body1 = page1.json();
    expect(body1.events).toHaveLength(2);
    expect(body1.has_more).toBe(true);
    expect(body1.cursor).toBeDefined();
    expect(body1.events[0].message).toBe("Event 0");
    expect(body1.events[1].message).toBe("Event 1");

    const page2 = await queryEvents({ limit: "2", order: "asc", cursor: body1.cursor });
    const body2 = page2.json();
    expect(body2.events).toHaveLength(2);
    expect(body2.events[0].message).toBe("Event 2");
    expect(body2.events[1].message).toBe("Event 3");

    const ids1 = body1.events.map((e: any) => e.id);
    const ids2 = body2.events.map((e: any) => e.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);

    const page3 = await queryEvents({ limit: "2", order: "asc", cursor: body2.cursor });
    const body3 = page3.json();
    expect(body3.events).toHaveLength(1);
    expect(body3.events[0].message).toBe("Event 4");
    expect(body3.has_more).toBe(false);
  });

  it("excludes development events by default", async () => {
    await ingestEvents([
      { level: "info", message: "Production event", session_id: TEST_SESSION_ID },
      { level: "info", message: "Dev event", session_id: TEST_SESSION_ID, is_dev: true },
    ]);

    const res = await queryEvents();
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("Production event");
  });

  it("includes development events when data_mode=all", async () => {
    await ingestEvents([
      { level: "info", message: "Production event", session_id: TEST_SESSION_ID },
      { level: "info", message: "Dev event", session_id: TEST_SESSION_ID, is_dev: true },
    ]);

    const res = await queryEvents({ data_mode: "all" });
    const body = res.json();
    expect(body.events).toHaveLength(2);
  });

  it("filters by session_id", async () => {
    const sessionA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const sessionB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await ingestEvents([
      { level: "info", message: "Session A", session_id: sessionA },
      { level: "info", message: "Session B", session_id: sessionB },
    ]);

    const res = await queryEvents({ session_id: sessionA });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("Session A");
  });

  it("filters by environment", async () => {
    await ingestEvents([
      { level: "info", message: "iOS event", session_id: TEST_SESSION_ID, environment: "ios" },
      { level: "info", message: "iPadOS event", session_id: TEST_SESSION_ID, environment: "ipados" },
    ]);

    const res = await queryEvents({ environment: "ios" });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("iOS event");
  });

  it("filters by until timestamp", async () => {
    const earlier = new Date(Date.now() - 7200_000).toISOString(); // 2 hours ago
    const later = new Date().toISOString();
    const middle = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago

    await ingestEvents([
      { level: "info", message: "Earlier event", session_id: TEST_SESSION_ID, timestamp: earlier },
      { level: "info", message: "Later event", session_id: TEST_SESSION_ID, timestamp: later },
    ]);

    const res = await queryEvents({ until: middle });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("Earlier event");
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
    const body = res.json();
    expect(body.message).toBe("Find me");
    expect(typeof body.project_id).toBe("string");
    expect(body.project_id.length).toBeGreaterThan(0);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("denies cross-team access to event", async () => {
    // Ingest event with team A's key
    await ingestEvents([{ level: "info", message: "Team A event", session_id: TEST_SESSION_ID }]);

    const listRes = await queryEvents();
    const eventId = listRes.json().events[0].id;

    // Create second user (gets own team)
    const { token: otherToken, teamId: otherTeamId } = await createUserAndGetToken(app, "other@owlmetry.com", "Other");
    const otherAgentKey = await createAgentKey(app, otherToken, otherTeamId, ["events:read"]);

    // Team B's agent key should not see Team A's event
    const res = await app.inject({
      method: "GET",
      url: `/v1/events/${eventId}`,
      headers: { authorization: `Bearer ${otherAgentKey}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
