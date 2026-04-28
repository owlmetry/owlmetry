import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";
import { TEST_DB_URL } from "./setup.js";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { generateKeyPairSync } from "node:crypto";
import {
  apps,
  teams,
  teamMembers,
  users,
  projects,
  projectIntegrations,
  appStoreReviews,
  schema,
} from "@owlmetry/db";
import { clearAppStoreConnectTokenCache } from "../utils/app-store-connect/client.js";
import type { NotificationDispatcher } from "../services/notifications/dispatcher.js";

const dbClient = postgres(TEST_DB_URL, { max: 1 });
const db = drizzle(dbClient, { schema });

const PRIVATE_KEY_PEM = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();

let teamId: string;
let projectId: string;
let appleAppId: string;
let userId: string;

const enqueueMock = vi.fn(
  async (_input: Parameters<NotificationDispatcher["enqueue"]>[0]) => ({
    notificationIds: [] as string[],
  }),
);
const mockDispatcher = { enqueue: enqueueMock } as unknown as NotificationDispatcher;

async function setIntegration(opts: { enabled?: boolean } = {}): Promise<void> {
  await db
    .insert(projectIntegrations)
    .values({
      project_id: projectId,
      provider: "app-store-connect",
      enabled: opts.enabled ?? true,
      config: {
        issuer_id: "ba9b5d8b-7fe8-46f8-9960-9a3720f88015",
        key_id: "ABC1234567",
        private_key_p8: PRIVATE_KEY_PEM,
      },
    })
    .onConflictDoNothing();
}

beforeAll(async () => {
  const [team] = await db
    .insert(teams)
    .values({ name: "ASC Test Team", slug: `asc-${Date.now()}` })
    .returning({ id: teams.id });
  teamId = team.id;
  const [project] = await db
    .insert(projects)
    .values({ team_id: teamId, name: "ASC Test", slug: `asc-${Date.now()}`, color: "#ff0000" })
    .returning({ id: projects.id });
  projectId = project.id;
  const [app] = await db
    .insert(apps)
    .values({
      team_id: teamId,
      project_id: projectId,
      name: "Test App",
      platform: "apple",
      bundle_id: "com.example.test",
      apple_app_store_id: 999999999,
    })
    .returning({ id: apps.id });
  appleAppId = app.id;
  const [user] = await db
    .insert(users)
    .values({ email: `asc-${Date.now()}@example.com`, name: "ASC Tester" })
    .returning({ id: users.id });
  userId = user.id;
  await db.insert(teamMembers).values({ team_id: teamId, user_id: userId, role: "owner" });
});

beforeEach(async () => {
  // Reset reviews + integration before each test so cases don't bleed.
  await db.delete(appStoreReviews).where(eq(appStoreReviews.app_id, appleAppId));
  await db.delete(projectIntegrations).where(eq(projectIntegrations.project_id, projectId));
  enqueueMock.mockClear();
  clearAppStoreConnectTokenCache();
});

afterAll(async () => {
  await db.delete(appStoreReviews).where(eq(appStoreReviews.app_id, appleAppId));
  await db.delete(projectIntegrations).where(eq(projectIntegrations.project_id, projectId));
  await db.delete(apps).where(eq(apps.team_id, teamId));
  await db.delete(teamMembers).where(eq(teamMembers.team_id, teamId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(projects).where(eq(projects.team_id, teamId));
  await db.delete(teams).where(eq(teams.id, teamId));
  await dbClient.end();
});

function jobCtx() {
  return {
    runId: "test-run",
    updateProgress: async () => {},
    isCancelled: () => false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    db,
    createClient: () => postgres(TEST_DB_URL, { max: 1 }),
    emailService: undefined,
  };
}

function makeReviewPayload(reviewId: string, opts: { rating?: number; territory?: string } = {}) {
  return {
    id: reviewId,
    type: "customerReviews",
    attributes: {
      rating: opts.rating ?? 5,
      title: `Title ${reviewId}`,
      body: `Body ${reviewId}`,
      reviewerNickname: `User${reviewId}`,
      createdDate: "2026-01-15T10:00:00Z",
      territory: opts.territory ?? "USA",
    },
  };
}

describe("app_store_connect_reviews_sync", () => {
  it("ingests reviews and maps ASC alpha-3 territory to alpha-2 country_code", async () => {
    await setIntegration();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            makeReviewPayload("rev-1", { territory: "USA" }),
            makeReviewPayload("rev-2", { territory: "GBR", rating: 4 }),
            makeReviewPayload("rev-3", { territory: "DEU", rating: 1 }),
          ],
          links: {},
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(result.reviews_ingested).toBe(3);
    expect(result.errors).toBe(0);
    expect(result.aborted).toBe(false);

    const rows = await db
      .select()
      .from(appStoreReviews)
      .where(eq(appStoreReviews.app_id, appleAppId));
    expect(rows).toHaveLength(3);
    const byCountry = new Map(rows.map((r) => [r.external_id, r.country_code]));
    expect(byCountry.get("rev-1")).toBe("us");
    expect(byCountry.get("rev-2")).toBe("gb");
    expect(byCountry.get("rev-3")).toBe("de");

    vi.unstubAllGlobals();
  });

  it("is idempotent — re-running the same response inserts zero duplicates", async () => {
    await setIntegration();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [makeReviewPayload("rev-1"), makeReviewPayload("rev-2")],
          links: {},
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const first = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });
    expect(first.reviews_ingested).toBe(2);

    const second = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });
    expect(second.reviews_ingested).toBe(0);
    expect(second.reviews_skipped_duplicate).toBe(2);

    vi.unstubAllGlobals();
  });

  it("aborts the entire run on auth_error (401) without partial inserts", async () => {
    await setIntegration();
    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(result.aborted).toBe(true);
    expect(result.abort_reason).toContain("auth_error");
    expect(result.reviews_ingested).toBe(0);

    vi.unstubAllGlobals();
  });

  it("paginates through every page until next link is absent", async () => {
    await setIntegration();

    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            data: [makeReviewPayload("rev-1"), makeReviewPayload("rev-2")],
            links: {
              next: "https://api.appstoreconnect.apple.com/v1/apps/999999999/customerReviews?cursor=PAGE2",
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: [makeReviewPayload("rev-3")],
          links: {},
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(callCount).toBe(2);
    expect(result.pages_fetched).toBe(2);
    expect(result.reviews_ingested).toBe(3);

    vi.unstubAllGlobals();
  });

  it("hard-deletes reviews missing from ASC after a successful full sync", async () => {
    await setIntegration();
    // Pre-seed two rows: one that ASC will return ("kept"), one it won't ("gone").
    await db.insert(appStoreReviews).values([
      {
        team_id: teamId,
        project_id: projectId,
        app_id: appleAppId,
        store: "app_store",
        external_id: "kept-1",
        rating: 5,
        body: "still on apple",
        country_code: "us",
        created_at_in_store: new Date("2026-01-10"),
      },
      {
        team_id: teamId,
        project_id: projectId,
        app_id: appleAppId,
        store: "app_store",
        external_id: "gone-1",
        rating: 1,
        body: "removed by apple",
        country_code: "us",
        created_at_in_store: new Date("2026-01-09"),
      },
    ]);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [makeReviewPayload("kept-1"), makeReviewPayload("new-1")],
          links: {},
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(result.reviews_ingested).toBe(1);
    expect(result.reviews_skipped_duplicate).toBe(1);
    expect(result.reviews_deleted).toBe(1);

    const remaining = await db
      .select({ external_id: appStoreReviews.external_id })
      .from(appStoreReviews)
      .where(eq(appStoreReviews.app_id, appleAppId));
    expect(remaining.map((r) => r.external_id).sort()).toEqual(["kept-1", "new-1"]);

    vi.unstubAllGlobals();
  });

  it("does not delete anything when pagination errors out partway", async () => {
    await setIntegration();
    await db.insert(appStoreReviews).values({
      team_id: teamId,
      project_id: projectId,
      app_id: appleAppId,
      store: "app_store",
      external_id: "preexisting-1",
      rating: 5,
      body: "untouched",
      country_code: "us",
      created_at_in_store: new Date("2026-01-10"),
    });

    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            data: [makeReviewPayload("rev-1")],
            links: {
              next: "https://api.appstoreconnect.apple.com/v1/apps/999999999/customerReviews?cursor=PAGE2",
            },
          }),
          { status: 200 },
        );
      }
      return new Response("upstream blew up", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(result.errors).toBeGreaterThan(0);
    expect(result.reviews_deleted).toBe(0);

    const remaining = await db
      .select({ external_id: appStoreReviews.external_id })
      .from(appStoreReviews)
      .where(eq(appStoreReviews.app_id, appleAppId));
    expect(remaining.map((r) => r.external_id).sort()).toEqual(["preexisting-1", "rev-1"]);

    vi.unstubAllGlobals();
  });

  it("wipes all rows for an app when ASC reports zero reviews", async () => {
    await setIntegration();
    await db.insert(appStoreReviews).values({
      team_id: teamId,
      project_id: projectId,
      app_id: appleAppId,
      store: "app_store",
      external_id: "stale-1",
      rating: 5,
      body: "no longer on asc",
      country_code: "us",
      created_at_in_store: new Date("2026-01-10"),
    });

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [], links: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(result.reviews_ingested).toBe(0);
    expect(result.reviews_deleted).toBe(1);

    const rows = await db
      .select()
      .from(appStoreReviews)
      .where(eq(appStoreReviews.app_id, appleAppId));
    expect(rows).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("throws when no integration is configured", async () => {
    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    await expect(
      appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId }),
    ).rejects.toThrow(/integration not found/i);
  });

  it("respects 429 Retry-After and counts the wait in the result (with short retry)", async () => {
    await setIntegration();
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "1" },
        });
      }
      return new Response(
        JSON.stringify({ data: [makeReviewPayload("rev-1")], links: {} }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(callCount).toBe(2);
    expect(result.rate_limit_waits).toBe(1);
    expect(result.rate_limit_wait_seconds).toBe(1);
    expect(result.reviews_ingested).toBe(1);
    expect(result.aborted).toBe(false);

    vi.unstubAllGlobals();
  }, 10_000);

  it("ignores reviews with unmappable territory codes (country_code stays null)", async () => {
    await setIntegration();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [makeReviewPayload("rev-x", { territory: "ZZZ" })],
          links: {},
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(result.reviews_ingested).toBe(1);
    const [row] = await db
      .select()
      .from(appStoreReviews)
      .where(and(eq(appStoreReviews.app_id, appleAppId), eq(appStoreReviews.external_id, "rev-x")));
    expect(row.country_code).toBeNull();

    vi.unstubAllGlobals();
  });

  it("does not fire app.review_new on first sync (existingBefore = 0)", async () => {
    await setIntegration();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [makeReviewPayload("rev-1"), makeReviewPayload("rev-2")],
          links: {},
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(result.reviews_ingested).toBe(2);
    expect(result.notifications_sent).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not fire app.review_new when no new reviews are inserted", async () => {
    await setIntegration();
    // Pre-seed two reviews so existingBefore > 0, but the response is the same
    // shape — both reviews exist already, so perAppNewCount = 0.
    await db.insert(appStoreReviews).values([
      {
        team_id: teamId,
        project_id: projectId,
        app_id: appleAppId,
        store: "app_store",
        external_id: "rev-1",
        rating: 5,
        body: "preexisting",
        country_code: "us",
        created_at_in_store: new Date("2026-01-15"),
      },
      {
        team_id: teamId,
        project_id: projectId,
        app_id: appleAppId,
        store: "app_store",
        external_id: "rev-2",
        rating: 4,
        body: "preexisting",
        country_code: "us",
        created_at_in_store: new Date("2026-01-14"),
      },
    ]);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [makeReviewPayload("rev-1"), makeReviewPayload("rev-2")],
          links: {},
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(result.reviews_ingested).toBe(0);
    expect(result.notifications_sent).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fires one app.review_new with count + snippet from the newest inserted review", async () => {
    await setIntegration();
    // Pre-seed one existing review so existingBefore > 0.
    await db.insert(appStoreReviews).values({
      team_id: teamId,
      project_id: projectId,
      app_id: appleAppId,
      store: "app_store",
      external_id: "old-1",
      rating: 5,
      body: "preexisting",
      country_code: "us",
      created_at_in_store: new Date("2026-01-10"),
    });

    // ASC returns old-1 (dup) + 2 new ones; ASC pagination is newest-first.
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            makeReviewPayload("new-1", { rating: 4 }),
            makeReviewPayload("new-2", { rating: 3 }),
            makeReviewPayload("old-1"),
          ],
          links: {},
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { appStoreConnectReviewsSyncHandler } = await import(
      "../jobs/app-store-connect-reviews-sync.js"
    );
    const result = await appStoreConnectReviewsSyncHandler(mockDispatcher)(jobCtx(), { project_id: projectId });

    expect(result.reviews_ingested).toBe(2);
    expect(result.notifications_sent).toBe(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);

    const call = enqueueMock.mock.calls[0][0];
    expect(call.type).toBe("app.review_new");
    expect(call.userIds).toEqual([userId]);
    expect(call.teamId).toBe(teamId);
    expect(call.payload.title).toBe("2 new reviews on Test App");
    // ASC returns newest-first → "new-1" is the latest (rating 4 → 4 stars + 1 hollow).
    expect(call.payload.body).toContain("★★★★☆");
    expect(call.payload.body).toContain("Body new-1");
    expect(call.payload.link).toBe(`/dashboard/reviews?app_id=${appleAppId}`);
    const data = call.payload.data as Record<string, unknown>;
    expect(data.count).toBe(2);
    expect(data.latest_review_id).toBe("new-1");
    expect(data.latest_rating).toBe(4);
    vi.unstubAllGlobals();
  });
});
