import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  createAgentKey,
  TEST_IMPORT_KEY,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let seedData: Awaited<ReturnType<typeof seedTestData>>;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  seedData = await seedTestData();
});

afterAll(async () => {
  await app.close();
});

function importEvents(events: any[], key = TEST_IMPORT_KEY) {
  return app.inject({
    method: "POST",
    url: "/v1/import",
    headers: { authorization: `Bearer ${key}` },
    payload: { events },
  });
}

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    message: "test event",
    level: "info",
    session_id: TEST_SESSION_ID,
    ...overrides,
  };
}

describe("auth & access control", () => {
  it("accepts valid import key", async () => {
    const res = await importEvents([makeEvent()]);
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);
  });

  it("rejects missing auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/import",
      payload: { events: [makeEvent()] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid key", async () => {
    const res = await importEvents([makeEvent()], "owl_import_invalidkey");
    expect(res.statusCode).toBe(401);
  });

  it("rejects client key", async () => {
    const res = await importEvents([makeEvent()], TEST_CLIENT_KEY);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/import/i);
  });

  it("rejects agent key", async () => {
    const res = await importEvents([makeEvent()], TEST_AGENT_KEY);
    expect(res.statusCode).toBe(403);
  });

  it("rejects JWT (user) auth", async () => {
    const token = await getToken(app);
    const res = await importEvents([makeEvent()], token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/import/i);
  });
});

describe("request validation", () => {
  it("rejects empty events array", async () => {
    const res = await importEvents([]);
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing events field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/import",
      headers: { authorization: `Bearer ${TEST_IMPORT_KEY}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts exactly 1000 events", async () => {
    const events = Array.from({ length: 1000 }, (_, i) =>
      makeEvent({ message: `event-${i}` })
    );
    const res = await importEvents(events);
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1000);
  });

  it("rejects more than 1000 events", async () => {
    const events = Array.from({ length: 1001 }, (_, i) =>
      makeEvent({ message: `event-${i}` })
    );
    const res = await importEvents(events);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/1000/);
  });
});


describe("event field validation", () => {
  it("rejects missing message", async () => {
    const res = await importEvents([{ level: "info", session_id: TEST_SESSION_ID }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().rejected).toBe(1);
    expect(res.json().errors[0].message).toMatch(/message/);
  });

  it("rejects missing level", async () => {
    const res = await importEvents([{ message: "test", session_id: TEST_SESSION_ID }]);
    expect(res.json().rejected).toBe(1);
    expect(res.json().errors[0].message).toMatch(/level/);
  });

  it("rejects invalid level", async () => {
    const res = await importEvents([makeEvent({ level: "critical" })]);
    expect(res.json().rejected).toBe(1);
  });

  it("rejects missing session_id", async () => {
    const res = await importEvents([{ message: "test", level: "info" }]);
    expect(res.json().rejected).toBe(1);
    expect(res.json().errors[0].message).toMatch(/session_id/);
  });

  it("accepts event with all optional fields", async () => {
    const res = await importEvents([
      makeEvent({
        user_id: "user_123",
        source_module: "main",
        screen_name: "home",
        custom_attributes: { key: "value" },
        environment: "ios",
        os_version: "17.0",
        app_version: "1.0.0",
        device_model: "iPhone 15",
        build_number: "100",
        locale: "en_US",
        is_dev: false,
        experiments: { variant: "a" },
        timestamp: new Date().toISOString(),
      }),
    ]);
    expect(res.json().accepted).toBe(1);
  });

  it("accepts event with only required fields", async () => {
    const res = await importEvents([makeEvent()]);
    expect(res.json().accepted).toBe(1);
    expect(res.json().rejected).toBe(0);
  });

  it("truncates custom attribute values over 200 chars", async () => {
    const longValue = "a".repeat(300);
    const res = await importEvents([
      makeEvent({ custom_attributes: { long: longValue } }),
    ]);
    expect(res.json().accepted).toBe(1);

    // Verify in DB
    const client = postgres(TEST_DB_URL, { max: 1 });
    const rows = await client`SELECT custom_attributes FROM events LIMIT 1`;
    await client.end();
    expect(rows[0].custom_attributes.long.length).toBe(200);
  });

  it("handles mixed valid and invalid events", async () => {
    const res = await importEvents([
      makeEvent({ message: "valid" }),
      { level: "info" }, // missing message and session_id
      makeEvent({ message: "also valid" }),
    ]);
    expect(res.json().accepted).toBe(2);
    expect(res.json().rejected).toBe(1);
  });
});


describe("timestamp handling", () => {
  it("accepts timestamp 60 days ago", async () => {
    const ts = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const res = await importEvents([makeEvent({ timestamp: ts })]);
    expect(res.json().accepted).toBe(1);
  });

  it("accepts timestamp 1 year ago", async () => {
    const ts = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const res = await importEvents([makeEvent({ timestamp: ts })]);
    expect(res.json().accepted).toBe(1);
  });

  it("accepts timestamp from 2021", async () => {
    const res = await importEvents([
      makeEvent({ timestamp: "2021-01-01T00:00:00.000Z" }),
    ]);
    expect(res.json().accepted).toBe(1);
  });

  it("rejects invalid ISO 8601 timestamp", async () => {
    const res = await importEvents([makeEvent({ timestamp: "not-a-date" })]);
    expect(res.json().rejected).toBe(1);
    expect(res.json().errors[0].message).toMatch(/timestamp/);
  });

  it("accepts missing timestamp (defaults to now)", async () => {
    const res = await importEvents([makeEvent()]);
    expect(res.json().accepted).toBe(1);
  });

  it("rejects timestamp more than 5 min in the future", async () => {
    const ts = new Date(Date.now() + 10 * 60_000).toISOString();
    const res = await importEvents([makeEvent({ timestamp: ts })]);
    expect(res.json().rejected).toBe(1);
    expect(res.json().errors[0].message).toMatch(/future/);
  });

  it("contrast: ingest rejects 60-day-old timestamp", async () => {
    const ts = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [makeEvent({ timestamp: ts })],
      },
    });
    // Ingest should reject it (30-day limit)
    expect(res.json().rejected).toBe(1);
    expect(res.json().errors[0].message).toMatch(/30 days/);
  });
});


describe("no bundle_id required", () => {
  it("succeeds without bundle_id for apple app", async () => {
    const res = await importEvents([makeEvent()]);
    expect(res.json().accepted).toBe(1);
  });

  it("ignores wrong bundle_id (field is not used)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/import",
      headers: { authorization: `Bearer ${TEST_IMPORT_KEY}` },
      payload: {
        bundle_id: "com.wrong.bundle",
        events: [makeEvent()],
      },
    });
    expect(res.json().accepted).toBe(1);
  });
});


describe("environment validation", () => {
  it("accepts valid environment for apple app", async () => {
    const res = await importEvents([makeEvent({ environment: "ios" })]);
    expect(res.json().accepted).toBe(1);
  });

  it("rejects invalid environment for apple app", async () => {
    const res = await importEvents([makeEvent({ environment: "android" })]);
    expect(res.json().rejected).toBe(1);
    expect(res.json().errors[0].message).toMatch(/environment/);
  });

  it("accepts no environment", async () => {
    const res = await importEvents([makeEvent()]);
    expect(res.json().accepted).toBe(1);
  });
});


describe("dual-write: metric events", () => {
  it("writes metric events for metric: messages", async () => {
    const res = await importEvents([
      makeEvent({
        message: "metric:photo-conversion:start",
        custom_attributes: {
          tracking_id: "11111111-1111-1111-1111-111111111111",
        },
      }),
    ]);
    expect(res.json().accepted).toBe(1);

    // Allow fire-and-forget to complete
    await new Promise((r) => setTimeout(r, 200));

    const client = postgres(TEST_DB_URL, { max: 1 });
    const rows = await client`
      SELECT metric_slug, phase, tracking_id FROM metric_events LIMIT 1
    `;
    await client.end();

    expect(rows).toHaveLength(1);
    expect(rows[0].metric_slug).toBe("photo-conversion");
    expect(rows[0].phase).toBe("start");
    expect(rows[0].tracking_id).toBe("11111111-1111-1111-1111-111111111111");
  });
});


describe("dual-write: funnel events", () => {
  it("writes funnel events for track: messages", async () => {
    const res = await importEvents([
      makeEvent({ message: "track:viewed-product" }),
    ]);
    expect(res.json().accepted).toBe(1);

    await new Promise((r) => setTimeout(r, 200));

    const client = postgres(TEST_DB_URL, { max: 1 });
    const rows = await client`
      SELECT step_name FROM funnel_events LIMIT 1
    `;
    await client.end();

    expect(rows).toHaveLength(1);
    expect(rows[0].step_name).toBe("viewed-product");
  });
});


describe("user upsert", () => {
  it("creates app_users with project_id and is_anonymous=false", async () => {
    const res = await importEvents([
      makeEvent({ user_id: "user_123" }),
    ]);
    expect(res.json().accepted).toBe(1);

    await new Promise((r) => setTimeout(r, 200));

    const client = postgres(TEST_DB_URL, { max: 1 });
    const rows = await client`
      SELECT project_id, user_id, is_anonymous FROM app_users
      WHERE user_id = 'user_123'
    `;
    await client.end();

    expect(rows).toHaveLength(1);
    expect(rows[0].project_id).toBe(seedData.projectId);
    expect(rows[0].is_anonymous).toBe(false);
  });

  it("marks anonymous users correctly", async () => {
    await importEvents([makeEvent({ user_id: "owl_anon_abc123" })]);
    await new Promise((r) => setTimeout(r, 200));

    const client = postgres(TEST_DB_URL, { max: 1 });
    const rows = await client`
      SELECT is_anonymous FROM app_users WHERE user_id = 'owl_anon_abc123'
    `;
    await client.end();
    expect(rows[0].is_anonymous).toBe(true);
  });

  it("creates junction entry in app_user_apps", async () => {
    await importEvents([makeEvent({ user_id: "junction_user" })]);
    await new Promise((r) => setTimeout(r, 200));

    const client = postgres(TEST_DB_URL, { max: 1 });
    const rows = await client`
      SELECT aua.app_id FROM app_user_apps aua
      JOIN app_users au ON au.id = aua.app_user_id
      WHERE au.user_id = 'junction_user'
    `;
    await client.end();
    expect(rows).toHaveLength(1);
    expect(rows[0].app_id).toBe(seedData.appId);
  });

  it("deduplicates same user_id across events", async () => {
    await importEvents([
      makeEvent({ user_id: "same_user" }),
      makeEvent({ user_id: "same_user", message: "second" }),
    ]);
    await new Promise((r) => setTimeout(r, 200));

    const client = postgres(TEST_DB_URL, { max: 1 });
    const rows = await client`
      SELECT COUNT(*) as count FROM app_users WHERE user_id = 'same_user'
    `;
    await client.end();
    expect(Number(rows[0].count)).toBe(1);
  });
});


describe("dedup", () => {
  it("deduplicates events with same client_event_id", async () => {
    const clientEventId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const ts = new Date().toISOString();
    await importEvents([makeEvent({ client_event_id: clientEventId, timestamp: ts })]);
    const res = await importEvents([makeEvent({ client_event_id: clientEventId, timestamp: ts })]);
    expect(res.json().accepted).toBe(0);
  });

  it("deduplicates historical events on re-import", async () => {
    const clientEventId = "11111111-2222-3333-4444-555555555555";
    const ts = "2023-06-15T10:00:00.000Z";
    await importEvents([makeEvent({ client_event_id: clientEventId, timestamp: ts })]);
    // Re-running the same import script — should dedup even though timestamp is years old
    const res = await importEvents([makeEvent({ client_event_id: clientEventId, timestamp: ts })]);
    expect(res.json().accepted).toBe(0);
  });
});


describe("large batch", () => {
  it("accepts 500 events", async () => {
    const events = Array.from({ length: 500 }, (_, i) =>
      makeEvent({ message: `batch-event-${i}` })
    );
    const res = await importEvents(events);
    expect(res.json().accepted).toBe(500);
  });
});


describe("no rate limiting", () => {
  it("handles 150 rapid requests without 429", async () => {
    const results = await Promise.all(
      Array.from({ length: 150 }, () => importEvents([makeEvent()]))
    );
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});


describe("key creation", () => {
  it("creates import key with JWT auth", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "My Import Key",
        key_type: "import",
        app_id: seedData.appId,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().api_key.secret).toMatch(/^owl_import_/);
    expect(res.json().api_key.key_type).toBe("import");
  });

  it("rejects import key without app_id", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Bad Import Key",
        key_type: "import",
        team_id: seedData.teamId,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/app_id/i);
  });

  it("agent key with apps:write creates import key", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const agentKey = await createAgentKey(app, token, teamId, [
      "apps:read",
      "apps:write",
      "projects:read",
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        name: "Agent-created Import Key",
        key_type: "import",
        app_id: seedData.appId,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().api_key.secret).toMatch(/^owl_import_/);
  });

  it("agent key cannot create client key", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const agentKey = await createAgentKey(app, token, teamId, [
      "apps:read",
      "apps:write",
      "projects:read",
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        name: "Should Fail",
        key_type: "client",
        app_id: seedData.appId,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/import/i);
  });

  it("agent key cannot create agent key", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const agentKey = await createAgentKey(app, token, teamId, [
      "apps:read",
      "apps:write",
      "projects:read",
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        name: "Should Fail",
        key_type: "agent",
        team_id: teamId,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/import/i);
  });

  it("agent key without apps:write cannot create import key", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const agentKey = await createAgentKey(app, token, teamId, [
      "apps:read",
      "projects:read",
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${agentKey}` },
      payload: {
        name: "Should Fail",
        key_type: "import",
        app_id: seedData.appId,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/apps:write/i);
  });
});
