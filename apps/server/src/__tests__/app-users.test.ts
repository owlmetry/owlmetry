import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  createAgentKey,
  getTokenAndTeamId,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
} from "./setup.js";

let app: FastifyInstance;
let appId: string;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  appId = seed.appId;
});

afterAll(async () => {
  await app.close();
});

function ingest(events: any[], key = TEST_CLIENT_KEY) {
  return app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${key}` },
    payload: { bundle_id: TEST_BUNDLE_ID, events },
  });
}

function getUsers(id: string, params: Record<string, string> = {}, key?: string) {
  const qs = new URLSearchParams(params).toString();
  return app.inject({
    method: "GET",
    url: `/v1/apps/${id}/users${qs ? `?${qs}` : ""}`,
    headers: { authorization: `Bearer ${key ?? TEST_AGENT_KEY}` },
  });
}

describe("GET /v1/apps/:id/users", () => {
  it("returns users after ingest", async () => {
    await ingest([
      { level: "info", message: "test", user_id: "user-1", session_id: TEST_SESSION_ID },
      { level: "info", message: "test", user_id: "owl_anon_abc", session_id: TEST_SESSION_ID },
    ]);

    // Wait for fire-and-forget upsert
    await new Promise((r) => setTimeout(r, 100));

    const res = await getUsers(appId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users).toHaveLength(2);
    expect(body.has_more).toBe(false);

    const realUser = body.users.find((u: any) => u.user_id === "user-1");
    expect(realUser.is_anonymous).toBe(false);

    const anonUser = body.users.find((u: any) => u.user_id === "owl_anon_abc");
    expect(anonUser.is_anonymous).toBe(true);
  });

  it("filters by is_anonymous", async () => {
    await ingest([
      { level: "info", message: "test", user_id: "user-1", session_id: TEST_SESSION_ID },
      { level: "info", message: "test", user_id: "owl_anon_abc", session_id: TEST_SESSION_ID },
    ]);
    await new Promise((r) => setTimeout(r, 100));

    const anonRes = await getUsers(appId, { is_anonymous: "true" });
    expect(anonRes.json().users).toHaveLength(1);
    expect(anonRes.json().users[0].user_id).toBe("owl_anon_abc");

    const realRes = await getUsers(appId, { is_anonymous: "false" });
    expect(realRes.json().users).toHaveLength(1);
    expect(realRes.json().users[0].user_id).toBe("user-1");
  });

  it("filters by search", async () => {
    await ingest([
      { level: "info", message: "test", user_id: "alice", session_id: TEST_SESSION_ID },
      { level: "info", message: "test", user_id: "bob", session_id: TEST_SESSION_ID },
    ]);
    await new Promise((r) => setTimeout(r, 100));

    const res = await getUsers(appId, { search: "ali" });
    expect(res.json().users).toHaveLength(1);
    expect(res.json().users[0].user_id).toBe("alice");
  });

  it("supports cursor pagination", async () => {
    // Ingest users at different times so last_seen_at differs
    await ingest([
      { level: "info", message: "test", user_id: "user-a", session_id: TEST_SESSION_ID },
    ]);
    await new Promise((r) => setTimeout(r, 150));

    await ingest([
      { level: "info", message: "test", user_id: "user-b", session_id: TEST_SESSION_ID },
    ]);
    await new Promise((r) => setTimeout(r, 150));

    await ingest([
      { level: "info", message: "test", user_id: "user-c", session_id: TEST_SESSION_ID },
    ]);
    await new Promise((r) => setTimeout(r, 150));

    const page1 = await getUsers(appId, { limit: "2" });
    const body1 = page1.json();
    expect(body1.users).toHaveLength(2);
    expect(body1.has_more).toBe(true);
    expect(body1.cursor).toBeTruthy();

    const page2 = await getUsers(appId, { limit: "2", cursor: body1.cursor });
    const body2 = page2.json();
    expect(body2.users).toHaveLength(1);
    expect(body2.has_more).toBe(false);
  });

  describe("billing_status filter", () => {
    async function setProps(user_id: string, properties: Record<string, string>) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/identity/properties",
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        payload: { user_id, properties },
      });
      expect(res.statusCode).toBe(200);
    }

    async function seedBillingUsers() {
      await ingest([
        { level: "info", message: "test", user_id: "paid-user", session_id: TEST_SESSION_ID },
        { level: "info", message: "test", user_id: "trial-user", session_id: TEST_SESSION_ID },
        { level: "info", message: "test", user_id: "free-user", session_id: TEST_SESSION_ID },
      ]);
      await new Promise((r) => setTimeout(r, 100));

      await setProps("paid-user", { rc_subscriber: "true", rc_period_type: "normal" });
      await setProps("trial-user", { rc_subscriber: "true", rc_period_type: "trial" });
      // free-user has no rc_* properties
    }

    function userIds(body: any): string[] {
      return body.users.map((u: any) => u.user_id).sort();
    }

    it("filters to only paid users", async () => {
      await seedBillingUsers();
      const res = await getUsers(appId, { billing_status: "paid" });
      expect(res.statusCode).toBe(200);
      expect(userIds(res.json())).toEqual(["paid-user"]);
    });

    it("filters to only trial users", async () => {
      await seedBillingUsers();
      const res = await getUsers(appId, { billing_status: "trial" });
      expect(userIds(res.json())).toEqual(["trial-user"]);
    });

    it("filters to only free users (no rc_subscriber, no rc_period_type=trial)", async () => {
      await seedBillingUsers();
      const res = await getUsers(appId, { billing_status: "free" });
      expect(userIds(res.json())).toEqual(["free-user"]);
    });

    it("combines tiers with OR semantics", async () => {
      await seedBillingUsers();
      const res = await getUsers(appId, { billing_status: "paid,trial" });
      expect(userIds(res.json())).toEqual(["paid-user", "trial-user"]);
    });

    it("treats all three tiers as no-op", async () => {
      await seedBillingUsers();
      const res = await getUsers(appId, { billing_status: "paid,trial,free" });
      expect(userIds(res.json())).toEqual(["free-user", "paid-user", "trial-user"]);
    });

    it("ignores unknown tiers and empty values", async () => {
      await seedBillingUsers();
      const res = await getUsers(appId, { billing_status: "  ,foo" });
      // all invalid → no filter
      expect(res.json().users).toHaveLength(3);
    });

    it("applies to team-scoped endpoint too", async () => {
      await seedBillingUsers();
      const token = await getToken(app);
      const res = await app.inject({
        method: "GET",
        url: "/v1/app-users?billing_status=paid",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(userIds(res.json())).toEqual(["paid-user"]);
    });
  });

  it("returns 404 for non-existent app", async () => {
    const res = await getUsers("00000000-0000-0000-0000-000000000000");
    expect(res.statusCode).toBe(404);
  });

  it("works with user auth (JWT)", async () => {
    await ingest([
      { level: "info", message: "test", user_id: "user-1", session_id: TEST_SESSION_ID },
    ]);
    await new Promise((r) => setTimeout(r, 100));

    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${appId}/users`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().users).toHaveLength(1);
  });

  it("rejects agent key without apps:read permission", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const keyWithoutAppsRead = await createAgentKey(app, token, teamId, ["events:read"]);

    const res = await getUsers(appId, {}, keyWithoutAppsRead);
    expect(res.statusCode).toBe(403);
  });
});
