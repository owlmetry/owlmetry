import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";
import { TEST_DB_URL } from "./setup.js";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { apps, teams, projects, appStoreRatings, schema } from "@owlmetry/db";

const dbClient = postgres(TEST_DB_URL, { max: 1 });
const db = drizzle(dbClient, { schema });

let teamId: string;
let projectId: string;
let appleAppId: string;

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
});

beforeEach(async () => {
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
    const result = await appStoreRatingsSyncHandler(jobCtx(), { app_id: appleAppId });

    expect(result.apps_processed).toBe(1);
    expect(result.rows_upserted).toBe(3);
    expect(result.tombstones_written).toBe(0);

    const rows = await db.select().from(appStoreRatings).where(eq(appStoreRatings.app_id, appleAppId));
    expect(rows).toHaveLength(3);
    const today = new Date().toISOString().slice(0, 10);
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
    await appStoreRatingsSyncHandler(jobCtx(), { app_id: appleAppId });

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
    await appStoreRatingsSyncHandler(jobCtx(), { app_id: appleAppId });

    // Backdate the existing rows so the second run's "today" UPSERT inserts new
    // rows rather than overwriting the seed snapshots.
    await dbClient`UPDATE app_store_ratings SET snapshot_date = CURRENT_DATE - INTERVAL '1 day' WHERE app_id = ${appleAppId}`;

    // Second run: only us populated; gb returns nothing → tombstone for gb.
    vi.stubGlobal("fetch", mockItunes({
      us: { averageUserRating: 4.5, userRatingCount: 100 },
    }));
    const result = await appStoreRatingsSyncHandler(jobCtx(), { app_id: appleAppId });
    expect(result.tombstones_written).toBe(1);

    const today = new Date().toISOString().slice(0, 10);
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
    await appStoreRatingsSyncHandler(jobCtx(), { app_id: appleAppId });

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
    await appStoreRatingsSyncHandler(jobCtx(), { app_id: appleAppId });

    // Re-run with a slightly different rating; same snapshot_date.
    vi.stubGlobal("fetch", mockItunes({
      us: { averageUserRating: 4.6, userRatingCount: 110 },
    }));
    await appStoreRatingsSyncHandler(jobCtx(), { app_id: appleAppId });

    const rows = await db.select().from(appStoreRatings).where(eq(appStoreRatings.app_id, appleAppId));
    expect(rows).toHaveLength(1);
    expect(rows[0].rating_count).toBe(110);
    expect(parseFloat(rows[0].average_rating!)).toBeCloseTo(4.6, 2);

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
    await appStoreRatingsSyncHandler(jobCtx(), { app_id: appleAppId });

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
});
