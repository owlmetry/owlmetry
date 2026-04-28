import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let testData: { teamId: string; projectId: string; appId: string };
let token: string;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  testData = await seedTestData();
  token = await getToken(app);
});

afterAll(async () => {
  await app.close();
});

// Insert a snapshot row directly. Bypasses the sync job so we can control
// snapshot_date precisely (the job always writes today's date).
async function insertSnapshot(args: {
  appId?: string;
  teamId?: string;
  projectId?: string;
  countryCode: string;
  averageRating: number | null;
  ratingCount: number;
  snapshotDate: string; // YYYY-MM-DD
}) {
  const client = postgres(TEST_DB_URL, { max: 1 });
  try {
    await client`
      INSERT INTO app_store_ratings
        (team_id, project_id, app_id, store, country_code,
         average_rating, rating_count, snapshot_date)
      VALUES (
        ${args.teamId ?? testData.teamId},
        ${args.projectId ?? testData.projectId},
        ${args.appId ?? testData.appId},
        'app_store',
        ${args.countryCode},
        ${args.averageRating},
        ${args.ratingCount},
        ${args.snapshotDate}
      )
    `;
  } finally {
    await client.end();
  }
}

const TODAY = "2026-04-28";
const YESTERDAY = "2026-04-27";

describe("GET /v1/projects/:id/apps/:appId/ratings — delta", () => {
  it("returns rating_count_delta per country and worldwide_rating_count_delta in summary when both snapshots exist", async () => {
    // US grew by 5; GB grew by 1.
    await insertSnapshot({ countryCode: "us", averageRating: 4.5, ratingCount: 100, snapshotDate: YESTERDAY });
    await insertSnapshot({ countryCode: "us", averageRating: 4.6, ratingCount: 105, snapshotDate: TODAY });
    await insertSnapshot({ countryCode: "gb", averageRating: 4.0, ratingCount: 50, snapshotDate: YESTERDAY });
    await insertSnapshot({ countryCode: "gb", averageRating: 4.0, ratingCount: 51, snapshotDate: TODAY });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/apps/${testData.appId}/ratings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const us = body.ratings.find((r: any) => r.country_code === "us");
    const gb = body.ratings.find((r: any) => r.country_code === "gb");
    expect(us.rating_count_delta).toBe(5);
    expect(gb.rating_count_delta).toBe(1);
    expect(body.summary.worldwide_rating_count_delta).toBe(6);
  });

  it("returns null delta when only one snapshot exists", async () => {
    await insertSnapshot({ countryCode: "us", averageRating: 4.5, ratingCount: 10, snapshotDate: TODAY });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/apps/${testData.appId}/ratings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const us = body.ratings.find((r: any) => r.country_code === "us");
    expect(us.rating_count_delta).toBeNull();
    expect(body.summary.worldwide_rating_count_delta).toBeNull();
  });

  it("counts a tombstone (latest=null,0) against the worldwide delta as a drop", async () => {
    // Country had 100 yesterday; today returns no result → tombstone.
    await insertSnapshot({ countryCode: "us", averageRating: 4.5, ratingCount: 100, snapshotDate: YESTERDAY });
    await insertSnapshot({ countryCode: "us", averageRating: null, ratingCount: 0, snapshotDate: TODAY });
    // GB stable for context.
    await insertSnapshot({ countryCode: "gb", averageRating: 4.2, ratingCount: 20, snapshotDate: YESTERDAY });
    await insertSnapshot({ countryCode: "gb", averageRating: 4.2, ratingCount: 22, snapshotDate: TODAY });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/apps/${testData.appId}/ratings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Tombstone is filtered out of the per-country list (existing behavior).
    expect(body.ratings.find((r: any) => r.country_code === "us")).toBeUndefined();
    // …but the worldwide delta still reflects the −100 drop plus +2 from gb.
    expect(body.summary.worldwide_rating_count_delta).toBe(-98);
  });

  it("excludes brand-new countries (no previous snapshot) from the worldwide delta", async () => {
    // US grew by 5 (has previous).
    await insertSnapshot({ countryCode: "us", averageRating: 4.5, ratingCount: 100, snapshotDate: YESTERDAY });
    await insertSnapshot({ countryCode: "us", averageRating: 4.6, ratingCount: 105, snapshotDate: TODAY });
    // BR is brand new today.
    await insertSnapshot({ countryCode: "br", averageRating: 5.0, ratingCount: 8, snapshotDate: TODAY });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/apps/${testData.appId}/ratings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.summary.worldwide_rating_count_delta).toBe(5);
    const br = body.ratings.find((r: any) => r.country_code === "br");
    expect(br.rating_count_delta).toBeNull();
  });
});

describe("GET /v1/projects/:id/ratings/by-country — delta", () => {
  it("sums per-app deltas per country", async () => {
    // Single app with two countries, each with two snapshots.
    await insertSnapshot({ countryCode: "us", averageRating: 4.0, ratingCount: 100, snapshotDate: YESTERDAY });
    await insertSnapshot({ countryCode: "us", averageRating: 4.1, ratingCount: 110, snapshotDate: TODAY });
    await insertSnapshot({ countryCode: "gb", averageRating: 4.0, ratingCount: 50, snapshotDate: YESTERDAY });
    await insertSnapshot({ countryCode: "gb", averageRating: 4.0, ratingCount: 53, snapshotDate: TODAY });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/ratings/by-country`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const us = body.countries.find((c: any) => c.country_code === "us");
    const gb = body.countries.find((c: any) => c.country_code === "gb");
    expect(us.rating_count_delta).toBe(10);
    expect(gb.rating_count_delta).toBe(3);
  });

  it("returns rating_count_delta = null for a country with no app having a previous snapshot", async () => {
    // Only one snapshot — no previous data, so delta is null.
    await insertSnapshot({ countryCode: "us", averageRating: 4.0, ratingCount: 100, snapshotDate: TODAY });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/ratings/by-country`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const us = body.countries.find((c: any) => c.country_code === "us");
    expect(us.rating_count_delta).toBeNull();
  });
});

describe("GET /v1/apps — worldwide_rating_count_delta", () => {
  it("includes per-app delta for apps with a previous snapshot", async () => {
    await insertSnapshot({ countryCode: "us", averageRating: 4.0, ratingCount: 200, snapshotDate: YESTERDAY });
    await insertSnapshot({ countryCode: "us", averageRating: 4.1, ratingCount: 215, snapshotDate: TODAY });

    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const apple = body.apps.find((a: any) => a.id === testData.appId);
    expect(apple.worldwide_rating_count_delta).toBe(15);
  });

  it("returns null delta for apps with no app_store snapshots", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const a of body.apps) {
      expect(a.worldwide_rating_count_delta).toBeNull();
    }
  });
});
