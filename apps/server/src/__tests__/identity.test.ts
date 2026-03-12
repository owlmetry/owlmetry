import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
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
    payload: { bundle_id: "dev.owlmetry.test", events },
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

describe("POST /v1/identity/claim", () => {
  it("claims anonymous events and updates user_id", async () => {
    const anonId = "owl_anon_test-claim-001";

    // Ingest events with anonymous ID
    await ingest([
      { level: "info", message: "claim event 1", user_id: anonId, screen_name: "claim" },
      { level: "info", message: "claim event 2", user_id: anonId, screen_name: "claim" },
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
      { level: "info", message: "idem event", user_id: anonId },
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
      { level: "info", message: "test", user_id: anonId },
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
      { level: "info", message: "app-scoped event", user_id: anonId },
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
      { level: "info", message: "user A event", user_id: anonId1, screen_name: "isolation" },
      { level: "info", message: "user B event", user_id: anonId2, screen_name: "isolation" },
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
});
