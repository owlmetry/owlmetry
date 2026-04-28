import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_BACKEND_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
} from "./setup.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || "postgresql://localhost:5432/owlmetry_test";

let app: FastifyInstance;
let dbClient: postgres.Sql;

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
});

describe("POST /v1/feedback", () => {
  it("accepts a valid submission and persists the row", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        message: "The photo importer hangs after 10 images",
        session_id: TEST_SESSION_ID,
        submitter_name: "Jane Doe",
        submitter_email: "jane@example.com",
        app_version: "1.4.2",
        environment: "ios",
        device_model: "iPhone15,2",
        os_version: "17.4",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof body.created_at).toBe("string");

    const rows = await dbClient`SELECT * FROM feedback WHERE id = ${body.id}`;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.message).toBe("The photo importer hangs after 10 images");
    expect(row.submitter_name).toBe("Jane Doe");
    expect(row.submitter_email).toBe("jane@example.com");
    expect(row.session_id).toBe(TEST_SESSION_ID);
    expect(row.status).toBe("new");
    expect(row.environment).toBe("ios");
    expect(row.device_model).toBe("iPhone15,2");
    expect(row.os_version).toBe("17.4");
    expect(row.app_version).toBe("1.4.2");
    expect(row.is_dev).toBe(false);
  });

  it("persists minimal submission (message only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, message: "Love this app!" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    const rows = await dbClient`SELECT * FROM feedback WHERE id = ${body.id}`;
    expect(rows[0].submitter_name).toBeNull();
    expect(rows[0].submitter_email).toBeNull();
    expect(rows[0].session_id).toBeNull();
  });

  it("honors is_dev flag from payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, message: "dev build test", is_dev: true },
    });
    expect(res.statusCode).toBe(201);
    const rows = await dbClient`SELECT is_dev FROM feedback WHERE id = ${res.json().id}`;
    expect(rows[0].is_dev).toBe(true);
  });

  it("captures country_code from CF-IPCountry header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        Authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "CF-IPCountry": "NL",
      },
      payload: { bundle_id: TEST_BUNDLE_ID, message: "hoi" },
    });
    expect(res.statusCode).toBe(201);
    const rows = await dbClient`SELECT country_code FROM feedback WHERE id = ${res.json().id}`;
    expect(rows[0].country_code).toBe("NL");
  });

  it("leaves country_code null when CF-IPCountry is absent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, message: "no header" },
    });
    expect(res.statusCode).toBe(201);
    const rows = await dbClient`SELECT country_code FROM feedback WHERE id = ${res.json().id}`;
    expect(rows[0].country_code).toBeNull();
  });

  it("leaves country_code null for CF-IPCountry=XX (unknown)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        Authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "CF-IPCountry": "XX",
      },
      payload: { bundle_id: TEST_BUNDLE_ID, message: "unknown" },
    });
    expect(res.statusCode).toBe(201);
    const rows = await dbClient`SELECT country_code FROM feedback WHERE id = ${res.json().id}`;
    expect(rows[0].country_code).toBeNull();
  });

  it("ignores CF-IPCountry for backend apps", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: {
        Authorization: `Bearer ${TEST_BACKEND_CLIENT_KEY}`,
        "CF-IPCountry": "NL",
      },
      payload: { message: "from a backend service" },
    });
    expect(res.statusCode).toBe(201);
    const rows = await dbClient`SELECT country_code FROM feedback WHERE id = ${res.json().id}`;
    expect(rows[0].country_code).toBeNull();
  });

  it("rewrites user_id through claim map when anon id has been claimed", async () => {
    const [project] = await dbClient`SELECT id FROM projects WHERE slug = 'test-project' LIMIT 1`;
    const projectId = project.id;

    await dbClient`
      INSERT INTO app_users (project_id, user_id, is_anonymous, claimed_from)
      VALUES (${projectId}, 'user-42', false, ${dbClient.json(["owl_anon_abc"])})
    `;

    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        message: "late feedback after claim",
        user_id: "owl_anon_abc",
      },
    });
    expect(res.statusCode).toBe(201);
    const rows = await dbClient`SELECT user_id FROM feedback WHERE id = ${res.json().id}`;
    expect(rows[0].user_id).toBe("user-42");
  });

  it("rejects missing bundle_id when app has bundle_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { message: "oops" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/bundle_id/);
  });

  it("rejects mismatched bundle_id with 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: "com.wrong.id", message: "oops" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts missing bundle_id for backend apps (bundle_id is null)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_BACKEND_CLIENT_KEY}` },
      payload: { message: "backend feedback" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("rejects blank message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, message: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/message/);
  });

  it("rejects message over 4000 characters", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, message: "x".repeat(4001) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/4000/);
  });

  it("rejects invalid submitter_email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        message: "hi",
        submitter_email: "not an email",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/email/i);
  });

  it("rejects non-UUID session_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        message: "hi",
        session_id: "not-a-uuid",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/session_id/);
  });

  it("rejects environment that doesn't match app platform", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        message: "hi",
        environment: "android",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      payload: { bundle_id: TEST_BUNDLE_ID, message: "hi" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with agent key (client key required)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { Authorization: `Bearer ${TEST_AGENT_KEY}` },
      payload: { bundle_id: TEST_BUNDLE_ID, message: "hi" },
    });
    expect(res.statusCode).toBe(403);
  });
});
