import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createUserAndGetToken,
  createAgentKey,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let dbClient: postgres.Sql;
let token: string;
let teamId: string;
let userId: string;

beforeAll(async () => {
  app = await buildApp();
  dbClient = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await dbClient.end();
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
  const result = await getTokenAndTeamId(app);
  token = result.token;
  teamId = result.teamId;
  const [owner] = await dbClient`SELECT id FROM users WHERE email = 'test@owlmetry.com'`;
  userId = owner.id;
});

describe("POST /v1/devices", () => {
  it("registers a new device", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${token}` },
      payload: { channel: "mobile_push", platform: "ios", token: "abc123", environment: "production", app_version: "1.0" },
    });
    expect(res.statusCode).toBe(201);
    const row = await dbClient`SELECT user_id, channel, token FROM user_devices WHERE token = 'abc123'`;
    expect(row).toHaveLength(1);
    expect(row[0].user_id).toBe(userId);
  });

  it("reusing the same token under a different user reassigns ownership", async () => {
    const u2 = await createUserAndGetToken(app, "device-reuse@owlmetry.com");
    await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${token}` },
      payload: { channel: "mobile_push", platform: "ios", token: "shared-token" },
    });
    await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${u2.token}` },
      payload: { channel: "mobile_push", platform: "ios", token: "shared-token" },
    });
    const rows = await dbClient`SELECT user_id FROM user_devices WHERE token = 'shared-token'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(u2.userId);
  });

  it("rejects invalid channel", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${token}` },
      payload: { channel: "bogus", platform: "ios", token: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid platform", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${token}` },
      payload: { channel: "mobile_push", platform: "windows", token: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing platform", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${token}` },
      payload: { channel: "mobile_push", token: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("agent key gets 403", async () => {
    const agentKey = await createAgentKey(app, token, teamId, ["events:read"]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${agentKey}` },
      payload: { channel: "mobile_push", platform: "ios", token: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/devices", () => {
  it("lists only the current user's devices", async () => {
    const u2 = await createUserAndGetToken(app, "device-list@owlmetry.com");
    await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${token}` },
      payload: { channel: "mobile_push", platform: "ios", token: "mine-1" },
    });
    await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${u2.token}` },
      payload: { channel: "mobile_push", platform: "ios", token: "theirs-1" },
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().devices).toHaveLength(1);
    expect(res.json().devices[0].id).toBeTruthy();
  });
});

describe("DELETE /v1/devices/:id", () => {
  it("removes the row", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${token}` },
      payload: { channel: "mobile_push", platform: "ios", token: "to-delete" },
    });
    const id = create.json().device.id;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/devices/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = await dbClient`SELECT id FROM user_devices WHERE id = ${id}`;
    expect(rows).toHaveLength(0);
  });

  it("returns 404 when deleting another user's device", async () => {
    const u2 = await createUserAndGetToken(app, "device-other@owlmetry.com");
    const create = await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { Authorization: `Bearer ${u2.token}` },
      payload: { channel: "mobile_push", platform: "ios", token: "their-device" },
    });
    const id = create.json().device.id;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/devices/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
