import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  TEST_CLIENT_KEY,
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

describe("PATCH /v1/auth/me — preferences", () => {
  it("persists a column order on the events page", async () => {
    const token = await getToken(app);

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        preferences: {
          ui: { columns: { events: { order: ["timestamp", "level", "message"] } } },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const prefs = res.json().user.preferences;
    expect(prefs.ui.columns.events.order).toEqual(["timestamp", "level", "message"]);
  });

  it("merges separate sub-objects across calls (events then users)", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        preferences: {
          ui: { columns: { events: { order: ["level", "message"] } } },
        },
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        preferences: {
          ui: { columns: { users: { order: ["user_id", "type"] } } },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const prefs = res.json().user.preferences;
    // Both sub-keys should survive the merge.
    expect(prefs.ui.columns.events.order).toEqual(["level", "message"]);
    expect(prefs.ui.columns.users.order).toEqual(["user_id", "type"]);
  });

  it("PATCH name-only leaves preferences untouched", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        preferences: {
          ui: { columns: { events: { order: ["timestamp"] } } },
        },
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Renamed" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.name).toBe("Renamed");
    expect(body.user.preferences.ui.columns.events.order).toEqual(["timestamp"]);
  });

  it("strips unknown top-level keys from preferences", async () => {
    const token = await getToken(app);

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        preferences: {
          ui: { columns: { events: { order: ["timestamp"] } } },
          evil: "ignored",
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.preferences).not.toHaveProperty("evil");
    expect(res.json().user.preferences.ui.columns.events.order).toEqual(["timestamp"]);
  });

  it("coerces non-string order entries by filtering them out", async () => {
    const token = await getToken(app);

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        preferences: {
          ui: { columns: { events: { order: ["timestamp", 123, null, "message"] } } },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.preferences.ui.columns.events.order).toEqual(["timestamp", "message"]);
  });

  it("returns 403 when called with an API key", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        preferences: { ui: { columns: { events: { order: ["timestamp"] } } } },
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it("GET /me returns preferences default-empty for new users", async () => {
    const token = await getToken(app);

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.preferences).toEqual({});
  });
});
