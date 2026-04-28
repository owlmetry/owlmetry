import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { generateKeyPairSync } from "node:crypto";
import {
  appStoreReviews,
  projectIntegrations,
  apps as appsTable,
  schema,
} from "@owlmetry/db";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createAgentKey,
} from "./setup.js";
import { clearAppStoreConnectTokenCache } from "../utils/app-store-connect/client.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || "postgresql://localhost:5432/owlmetry_test";

let app: FastifyInstance;
let dbClient: postgres.Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;
let token: string;
let teamId: string;
let projectId: string;
let appId: string;

const PRIVATE_KEY_PEM = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();

beforeAll(async () => {
  app = await buildApp();
  dbClient = postgres(TEST_DB_URL, { max: 1 });
  db = drizzle(dbClient, { schema });
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

  const projRes = await app.inject({
    method: "GET",
    url: "/v1/projects",
    headers: { Authorization: `Bearer ${token}` },
  });
  projectId = JSON.parse(projRes.body).projects[0].id;

  const projDetail = await app.inject({
    method: "GET",
    url: `/v1/projects/${projectId}`,
    headers: { Authorization: `Bearer ${token}` },
  });
  appId = JSON.parse(projDetail.body).apps[0].id;

  // Apple-flavour the seeded app + give it a numeric app store id so it shows up
  // in the reviews-response integration path.
  await db
    .update(appsTable)
    .set({ platform: "apple", apple_app_store_id: 999999999 })
    .where(eq(appsTable.id, appId));

  clearAppStoreConnectTokenCache();
});

async function setIntegration(): Promise<void> {
  await db
    .insert(projectIntegrations)
    .values({
      project_id: projectId,
      provider: "app-store-connect",
      enabled: true,
      config: {
        issuer_id: "ba9b5d8b-7fe8-46f8-9960-9a3720f88015",
        key_id: "ABC1234567",
        private_key_p8: PRIVATE_KEY_PEM,
      },
    });
}

async function insertReview(overrides: Partial<typeof appStoreReviews.$inferInsert> = {}) {
  const [row] = await db
    .insert(appStoreReviews)
    .values({
      team_id: teamId,
      project_id: projectId,
      app_id: appId,
      store: "app_store",
      external_id: overrides.external_id ?? `ext-${Date.now()}-${Math.random()}`,
      rating: 4,
      title: "Title",
      body: "Body",
      reviewer_name: "Reviewer",
      country_code: "us",
      created_at_in_store: new Date(),
      ...overrides,
    })
    .returning();
  return row;
}

function ascResponseFixture(opts: { id?: string; state?: string; body?: string } = {}) {
  return {
    data: {
      id: opts.id ?? "asc-resp-1",
      type: "customerReviewResponses",
      attributes: {
        responseBody: opts.body ?? "Thanks for the feedback!",
        state: opts.state ?? "PENDING_PUBLISH",
        lastModifiedDate: "2026-04-27T12:00:00Z",
      },
    },
  };
}

describe("PUT /v1/projects/:projectId/reviews/:reviewId/response", () => {
  it("posts a new response when none exists, persists ASC id + state + user", async () => {
    await setIntegration();
    const review = await insertReview({ external_id: "ext-new-reply" });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(String(url)).toContain("/v1/customerReviewResponses");
      const payload = JSON.parse(init!.body as string);
      expect(payload.data.attributes.responseBody).toBe("Thanks for that!");
      expect(payload.data.relationships.review.data.id).toBe("ext-new-reply");
      return new Response(JSON.stringify(ascResponseFixture({ id: "asc-1" })), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "Thanks for that!" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.developer_response).toBe("Thanks for the feedback!");
    expect(body.developer_response_id).toBe("asc-1");
    expect(body.developer_response_state).toBe("PENDING_PUBLISH");
    expect(body.responded_by_user_id).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1); // POST only, no prior DELETE.

    vi.unstubAllGlobals();
  });

  it("deletes the existing response then posts a new one when editing", async () => {
    await setIntegration();
    const review = await insertReview({
      external_id: "ext-edit-reply",
      developer_response: "Original",
      developer_response_at: new Date(),
      developer_response_id: "asc-existing",
      developer_response_state: "PUBLISHED",
    });

    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url: String(url) });
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(ascResponseFixture({ id: "asc-new", state: "PUBLISHED", body: "Updated reply" })), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "Updated reply" },
    });

    expect(res.statusCode).toBe(200);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toContain("/v1/customerReviewResponses/asc-existing");
    expect(calls[1].method).toBe("POST");
    const body = res.json();
    expect(body.developer_response).toBe("Updated reply");
    expect(body.developer_response_id).toBe("asc-new");
    expect(body.developer_response_state).toBe("PUBLISHED");

    vi.unstubAllGlobals();
  });

  it("recovers an external reply's ASC id before DELETE+POST when only the body is on file", async () => {
    await setIntegration();
    const review = await insertReview({
      external_id: "ext-edit-external",
      developer_response: "Externally created reply",
      developer_response_at: new Date(),
      // developer_response_id intentionally null
    });

    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(url) });
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            data: { id: "ext-edit-external", type: "customerReviews", attributes: {} },
            included: [{
              id: "asc-recovered-edit",
              type: "customerReviewResponses",
              attributes: { state: "PUBLISHED" },
            }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(ascResponseFixture({ id: "asc-replacement" })), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "Replacing the externally-created reply" },
    });

    expect(res.statusCode).toBe(200);
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE", "POST"]);
    expect(calls[0].url).toContain("/v1/customerReviews/ext-edit-external");
    expect(calls[1].url).toContain("/v1/customerReviewResponses/asc-recovered-edit");
    expect(res.json().developer_response_id).toBe("asc-replacement");

    vi.unstubAllGlobals();
  });

  it("rejects play_store reviews with 400 (Apple-only feature)", async () => {
    await setIntegration();
    const review = await insertReview({
      external_id: "ext-play",
      store: "play_store",
    });

    const res = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "Reply to a Play Store review" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/App Store/);
  });

  it("propagates ASC's 429 Retry-After header when Apple rate-limits", async () => {
    await setIntegration();
    const review = await insertReview({ external_id: "ext-rate-limited" });

    const fetchMock = vi.fn(
      async () => new Response(null, { status: 429, headers: { "Retry-After": "42" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "rate limited please" },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("42");

    vi.unstubAllGlobals();
  });

  it("rejects empty body with 400", async () => {
    await setIntegration();
    const review = await insertReview();

    const res = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "   " },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects body over the 5970-char limit", async () => {
    await setIntegration();
    const review = await insertReview();
    const huge = "x".repeat(5971);

    const res = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: huge },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/5970/);
  });

  it("returns 404 when the project has no active ASC integration", async () => {
    const review = await insertReview();

    const res = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "hi" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/integration not found/);
  });

  it("surfaces ASC 403 with a role-hint message", async () => {
    await setIntegration();
    const review = await insertReview();

    const fetchMock = vi.fn(async () =>
      new Response("forbidden", { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { body: "hello" },
    });

    expect(res.statusCode).toBe(502);

    vi.unstubAllGlobals();
  });

  it("allows agent keys with reviews:write to respond", async () => {
    await setIntegration();
    const review = await insertReview({ external_id: "ext-agent-respond" });

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(ascResponseFixture({ id: "asc-agent" })), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const agentKey = await createAgentKey(app, token, teamId, ["reviews:write", "reviews:read"]);
    const res = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${agentKey}` },
      payload: { body: "Replied via agent key" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.developer_response_id).toBe("asc-agent");
    // Agent-submitted replies leave responded_by_user_id null — there's no Owlmetry user attribution.
    expect(body.responded_by_user_id).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe("DELETE /v1/projects/:projectId/reviews/:reviewId/response", () => {
  it("clears the response and calls ASC DELETE when an ASC id is on file", async () => {
    await setIntegration();
    const review = await insertReview({
      external_id: "ext-del-reply",
      developer_response: "Posted reply",
      developer_response_at: new Date(),
      developer_response_id: "asc-to-delete",
      developer_response_state: "PUBLISHED",
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("DELETE");
      expect(String(url)).toContain("/v1/customerReviewResponses/asc-to-delete");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.developer_response).toBeNull();
    expect(body.developer_response_id).toBeNull();
    expect(body.developer_response_state).toBeNull();
    expect(body.responded_by_user_id).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("returns 404 when the review has no reply on file at all", async () => {
    await setIntegration();
    const review = await insertReview({
      external_id: "ext-never-replied",
      // developer_response* all intentionally null
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("recovers the ASC response id from Apple when only the body is on file (external reply)", async () => {
    await setIntegration();
    const review = await insertReview({
      external_id: "ext-external-reply",
      developer_response: "Reply that someone else posted in ASC's web UI",
      developer_response_at: new Date(),
      // developer_response_id intentionally null
    });

    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(url) });
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            data: { id: "ext-external-reply", type: "customerReviews", attributes: {} },
            included: [
              {
                id: "asc-recovered",
                type: "customerReviewResponses",
                attributes: { state: "PUBLISHED" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/v1/customerReviews/ext-external-reply");
    expect(calls[1].method).toBe("DELETE");
    expect(calls[1].url).toContain("/v1/customerReviewResponses/asc-recovered");

    vi.unstubAllGlobals();
  });

  it("clears local state when the lookup says Apple has no response (already removed externally)", async () => {
    await setIntegration();
    const review = await insertReview({
      external_id: "ext-stale-body",
      developer_response: "Stale body — Apple has already removed it",
      developer_response_at: new Date(),
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      // No `included` array → not_found from fetchCustomerReviewResponseId.
      return new Response(
        JSON.stringify({
          data: { id: "ext-stale-body", type: "customerReviews", attributes: {} },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.developer_response).toBeNull();
    expect(body.developer_response_id).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // GET only — no DELETE attempted.

    vi.unstubAllGlobals();
  });

  it("treats Apple's not_found as success (response was already removed externally)", async () => {
    await setIntegration();
    const review = await insertReview({
      external_id: "ext-already-gone",
      developer_response: "Posted reply",
      developer_response_at: new Date(),
      developer_response_id: "asc-already-gone",
      developer_response_state: "PUBLISHED",
    });

    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/reviews/${review.id}/response`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.developer_response_id).toBeNull();

    vi.unstubAllGlobals();
  });
});
