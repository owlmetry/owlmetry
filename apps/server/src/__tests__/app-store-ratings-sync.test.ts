import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";
import { TEST_DB_URL } from "./setup.js";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { apps, teams, teamMembers, users, projects, appStoreRatings, schema } from "@owlmetry/db";
import { todayUtcDateString } from "../jobs/app-store-ratings-sync.js";
import type { NotificationDispatcher } from "../services/notifications/dispatcher.js";

const dbClient = postgres(TEST_DB_URL, { max: 1 });
const db = drizzle(dbClient, { schema });

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

beforeAll(async () => {
  const [team] = await db
    .insert(teams)
    .values({ name: "App Store Ratings Sync Test", slug: `asrs-${Date.now()}` })
    .returning({ id: teams.id });
  teamId = team.id;
  const [project] = await db
    .insert(projects)
    .values({ team_id: teamId, name: "ASRS Test", slug: `asrs-${Date.now()}`, color: "#00ff00" })
    .returning({ id: projects.id });
  projectId = project.id;
  const [user] = await db
    .insert(users)
    .values({ email: `asrs-${Date.now()}@example.com`, name: "ASRS Tester" })
    .returning({ id: users.id });
  userId = user.id;
  await db.insert(teamMembers).values({ team_id: teamId, user_id: userId, role: "owner" });
});

beforeEach(async () => {
  enqueueMock.mockClear();
  await db.delete(appStoreRatings).where(eq(appStoreRatings.team_id, teamId));
  await db.delete(apps).where(eq(apps.team_id, teamId));
  const [row] = await db
    .insert(apps)
    .values({
      team_id: teamId,
      project_id: projectId,
      name: "Apple App",
      platform: "apple",
      bundle_id: "com.example.ratings",
    })
    .returning({ id: apps.id });
  appleAppId = row.id;
});

afterAll(async () => {
  await db.delete(appStoreRatings).where(eq(appStoreRatings.team_id, teamId));
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

// Build a fetch mock that returns rating data only for the listed countries.
// Every other storefront returns resultCount: 0 (cheap "not in this storefront").
function mockItunes(byCountry: Record<string, {
  averageUserRating: number;
  userRatingCount: number;
  averageUserRatingForCurrentVersion?: number;
  userRatingCountForCurrentVersion?: number;
  version?: string;
}>) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = new URL(String(url));
    const country = u.searchParams.get("country") ?? "";
    const data = byCountry[country];
    if (!data) {
      return new Response(JSON.stringify({ resultCount: 0, results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        resultCount: 1,
        results: [{ trackId: 1234567, bundleId: "com.example.ratings", ...data }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

describe("app_store_ratings_sync", () => {
  it("UPSERTs rows for each storefront that returned data, with today's snapshot_date", async () => {
    vi.stubGlobal("fetch", mockItunes({
      us: { averageUserRating: 4.5, userRatingCount: 1000, averageUserRatingForCurrentVersion: 4.6, userRatingCountForCurrentVersion: 200, version: "1.0.0" },
      gb: { averageUserRating: 4.2, userRatingCount: 500, version: "1.0.0" },
      de: { averageUserRating: 3.8, userRatingCount: 50, version: "1.0.0" },
    }));

    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    const result = await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    expect(result.apps_processed).toBe(1);
    expect(result.rows_upserted).toBe(3);
    expect(result.tombstones_written).toBe(0);

    const rows = await db.select().from(appStoreRatings).where(eq(appStoreRatings.app_id, appleAppId));
    expect(rows).toHaveLength(3);
    const today = todayUtcDateString();
    for (const r of rows) {
      expect(r.snapshot_date).toBe(today);
      expect(r.store).toBe("app_store");
      expect(["us", "gb", "de"]).toContain(r.country_code);
    }
    const us = rows.find((r) => r.country_code === "us")!;
    expect(parseFloat(us.average_rating!)).toBeCloseTo(4.5, 2);
    expect(us.rating_count).toBe(1000);

    vi.unstubAllGlobals();
  });

  it("recomputes worldwide cache as a weighted average across countries", async () => {
    vi.stubGlobal("fetch", mockItunes({
      us: { averageUserRating: 5.0, userRatingCount: 1000 },
      gb: { averageUserRating: 4.0, userRatingCount: 1000 },
    }));

    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    const [row] = await db.select().from(apps).where(eq(apps.id, appleAppId));
    // (5.0 * 1000 + 4.0 * 1000) / 2000 = 4.5
    expect(parseFloat(row.worldwide_average_rating!)).toBeCloseTo(4.5, 2);
    expect(row.worldwide_rating_count).toBe(2000);
    expect(row.ratings_synced_at).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it("writes a tombstone when a previously-active storefront returns nothing", async () => {
    // First run: us + gb populated.
    vi.stubGlobal("fetch", mockItunes({
      us: { averageUserRating: 4.5, userRatingCount: 100 },
      gb: { averageUserRating: 4.2, userRatingCount: 50 },
    }));
    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    // Backdate the existing rows so the second run's "today" UPSERT inserts new
    // rows rather than overwriting the seed snapshots. Compute yesterday in
    // JS UTC to match production's snapshot_date semantics — using SQL
    // CURRENT_DATE would drift if the Postgres session TZ isn't UTC.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await dbClient`UPDATE app_store_ratings SET snapshot_date = ${yesterday}::date WHERE app_id = ${appleAppId}`;

    // Second run: only us populated; gb returns nothing → tombstone for gb.
    vi.stubGlobal("fetch", mockItunes({
      us: { averageUserRating: 4.5, userRatingCount: 100 },
    }));
    const result = await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });
    expect(result.tombstones_written).toBe(1);

    const today = todayUtcDateString();
    const todayRows = await db
      .select()
      .from(appStoreRatings)
      .where(and(eq(appStoreRatings.app_id, appleAppId), eq(appStoreRatings.snapshot_date, today)));

    const tombstone = todayRows.find((r) => r.country_code === "gb")!;
    expect(tombstone).toBeDefined();
    expect(tombstone.average_rating).toBeNull();
    expect(tombstone.rating_count).toBe(0);

    // Worldwide cache should reflect only the still-active storefront (us).
    const [appRow] = await db.select().from(apps).where(eq(apps.id, appleAppId));
    expect(appRow.worldwide_rating_count).toBe(100);

    vi.unstubAllGlobals();
  });

  it("does not write rows for storefronts that never had data and return nothing today", async () => {
    vi.stubGlobal("fetch", mockItunes({ us: { averageUserRating: 4.5, userRatingCount: 100 } }));
    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    const rows = await db.select().from(appStoreRatings).where(eq(appStoreRatings.app_id, appleAppId));
    // Only the us row was written. None of the ~246 other storefronts produced
    // a row even though we queried iTunes for every one.
    expect(rows).toHaveLength(1);
    expect(rows[0].country_code).toBe("us");

    vi.unstubAllGlobals();
  });

  it("re-running the same day UPSERTs rather than duplicating rows", async () => {
    vi.stubGlobal("fetch", mockItunes({
      us: { averageUserRating: 4.5, userRatingCount: 100 },
    }));

    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    // Re-run with a slightly different rating; same snapshot_date.
    vi.stubGlobal("fetch", mockItunes({
      us: { averageUserRating: 4.6, userRatingCount: 110 },
    }));
    await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    const rows = await db.select().from(appStoreRatings).where(eq(appStoreRatings.app_id, appleAppId));
    expect(rows).toHaveLength(1);
    expect(rows[0].rating_count).toBe(110);
    expect(parseFloat(rows[0].average_rating!)).toBeCloseTo(4.6, 2);

    vi.unstubAllGlobals();
  });

  it("retries after a 403 rate-limit and eventually persists the data", async () => {
    let usAttempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const country = new URL(String(url)).searchParams.get("country") ?? "";
        if (country !== "us") {
          return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
        }
        usAttempt++;
        if (usAttempt <= 2) {
          // First two US calls get throttled; third succeeds.
          return new Response("rate limited", { status: 403 });
        }
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                trackId: 1,
                bundleId: "com.example.ratings",
                averageUserRating: 4.7,
                userRatingCount: 250,
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    const result = await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    expect(result.rows_upserted).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.throttle_hits).toBe(2);
    expect(result.retries).toBe(2);
    expect(result.retries_exhausted).toBe(0);

    const rows = await db.select().from(appStoreRatings).where(eq(appStoreRatings.app_id, appleAppId));
    expect(rows).toHaveLength(1);
    expect(rows[0].country_code).toBe("us");
    expect(rows[0].rating_count).toBe(250);

    vi.unstubAllGlobals();
  });

  it("counts a storefront as exhausted (not silently skipped) when retries don't recover", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const country = new URL(String(url)).searchParams.get("country") ?? "";
        if (country === "us") {
          // Persistent 403 — retries will be exhausted.
          return new Response("nope", { status: 403 });
        }
        return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
      }),
    );

    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    const result = await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    expect(result.errors).toBe(1);
    expect(result.retries_exhausted).toBe(1);
    expect(result.throttle_hits).toBeGreaterThanOrEqual(8);
    expect(result.rows_upserted).toBe(0);

    vi.unstubAllGlobals();
  });

  it("retries through 5xx transient errors", async () => {
    let usAttempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const country = new URL(String(url)).searchParams.get("country") ?? "";
        if (country !== "us") {
          return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
        }
        usAttempt++;
        if (usAttempt === 1) {
          return new Response("Bad Gateway", { status: 502 });
        }
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                trackId: 1,
                bundleId: "com.example.ratings",
                averageUserRating: 4.3,
                userRatingCount: 80,
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    const result = await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    expect(result.rows_upserted).toBe(1);
    expect(result.transient_hits).toBe(1);
    expect(result.retries).toBe(1);
    expect(result.errors).toBe(0);

    vi.unstubAllGlobals();
  });

  it("DISTINCT ON … ORDER BY snapshot_date DESC returns today's value over a historical row", async () => {
    // Seed a historical row directly.
    await db.insert(appStoreRatings).values({
      team_id: teamId,
      project_id: projectId,
      app_id: appleAppId,
      store: "app_store",
      country_code: "us",
      average_rating: "4.0",
      rating_count: 50,
      snapshot_date: "2024-01-01",
    });

    vi.stubGlobal("fetch", mockItunes({ us: { averageUserRating: 4.7, userRatingCount: 200 } }));
    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    const latest = await dbClient<{ average_rating: string; rating_count: number; snapshot_date: string }[]>`
      SELECT DISTINCT ON (country_code) average_rating, rating_count, snapshot_date::text AS snapshot_date
      FROM app_store_ratings WHERE app_id = ${appleAppId}
      ORDER BY country_code, snapshot_date DESC
    `;
    expect(latest).toHaveLength(1);
    expect(latest[0].rating_count).toBe(200);
    expect(parseFloat(latest[0].average_rating)).toBeCloseTo(4.7, 2);

    vi.unstubAllGlobals();
  });

  it("does not fire app.rating_changed on the first sync (oldCount is null)", async () => {
    vi.stubGlobal("fetch", mockItunes({ us: { averageUserRating: 4.5, userRatingCount: 200 } }));
    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    const result = await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    expect(result.notifications_sent).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fires app.rating_changed when the worldwide rating count goes up", async () => {
    // Seed an existing baseline: app already has count=100 from a prior sync.
    await db.update(apps).set({ worldwide_rating_count: 100 }).where(eq(apps.id, appleAppId));

    vi.stubGlobal("fetch", mockItunes({ us: { averageUserRating: 4.5, userRatingCount: 105 } }));
    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    const result = await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    expect(result.notifications_sent).toBe(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const call = enqueueMock.mock.calls[0][0];
    expect(call.type).toBe("app.rating_changed");
    expect(call.userIds).toEqual([userId]);
    expect(call.teamId).toBe(teamId);
    expect(call.payload.title).toBe("5 new ratings on Apple App");
    expect(call.payload.link).toBe(`/dashboard/projects/${projectId}`);
    const data = call.payload.data as Record<string, unknown>;
    expect(data.delta).toBe(5);
    expect(data.old_count).toBe(100);
    expect(data.new_count).toBe(105);
    expect(data.app_id).toBe(appleAppId);
    vi.unstubAllGlobals();
  });

  it("does not fire app.rating_changed when the count is unchanged", async () => {
    await db.update(apps).set({ worldwide_rating_count: 100 }).where(eq(apps.id, appleAppId));

    vi.stubGlobal("fetch", mockItunes({ us: { averageUserRating: 4.5, userRatingCount: 100 } }));
    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    const result = await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    expect(result.notifications_sent).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not fire app.rating_changed when the count decreases", async () => {
    // Decreases shouldn't notify — we only alert on positive deltas (= new ratings).
    await db.update(apps).set({ worldwide_rating_count: 100 }).where(eq(apps.id, appleAppId));

    vi.stubGlobal("fetch", mockItunes({ us: { averageUserRating: 4.5, userRatingCount: 90 } }));
    const { appStoreRatingsSyncHandler } = await import("../jobs/app-store-ratings-sync.js");
    const result = await appStoreRatingsSyncHandler(mockDispatcher)(jobCtx(), { app_id: appleAppId });

    expect(result.notifications_sent).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
