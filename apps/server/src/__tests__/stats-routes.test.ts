import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  setupTestDb,
  truncateAll,
  seedTestData,
  TEST_AGENT_KEY,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let testData: Awaited<ReturnType<typeof seedTestData>>;
let dbClient: postgres.Sql;

beforeAll(async () => {
  await setupTestDb();
  app = await buildApp();
  dbClient = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await app.close();
  await dbClient.end();
});

beforeEach(async () => {
  await truncateAll();
  testData = await seedTestData();
});

function utcDayOffset(daysAgo: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  return d.toISOString().slice(0, 10);
}

/** Insert a rollup row directly into events_daily, bypassing the aggregator. */
async function seedRollup(opts: {
  teamId: string;
  projectId: string;
  appId?: string | null;
  day: string;
  eventCount: number;
  uniqueUsers?: number;
  uniqueSessions?: number;
  isDev?: boolean;
}) {
  await dbClient`
    INSERT INTO events_daily (team_id, project_id, app_id, is_dev, day, event_count, unique_users, unique_sessions, error_count)
    VALUES (
      ${opts.teamId},
      ${opts.projectId},
      ${opts.appId ?? null},
      ${opts.isDev ?? false},
      ${opts.day},
      ${opts.eventCount},
      ${opts.uniqueUsers ?? 0},
      ${opts.uniqueSessions ?? 0},
      0
    )
  `;
}

describe("GET /v1/projects/:id/stats/:kind/:grain", () => {
  it("returns zero-padded daily series for the trailing window with current day excluded", async () => {
    // Seed 3 explicit days in the trailing 5-day window with known values.
    const day1 = utcDayOffset(1);
    const day3 = utcDayOffset(3);
    const day5 = utcDayOffset(5);
    await seedRollup({
      teamId: testData.teamId,
      projectId: testData.projectId,
      appId: null,
      day: day1,
      eventCount: 100,
      uniqueUsers: 50,
      uniqueSessions: 75,
    });
    await seedRollup({
      teamId: testData.teamId,
      projectId: testData.projectId,
      appId: null,
      day: day3,
      eventCount: 300,
      uniqueUsers: 150,
      uniqueSessions: 200,
    });
    await seedRollup({
      teamId: testData.teamId,
      projectId: testData.projectId,
      appId: null,
      day: day5,
      eventCount: 500,
      uniqueUsers: 250,
      uniqueSessions: 350,
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/stats/events/daily?days=7&data_mode=production`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.kind).toBe("events");
    expect(body.grain).toBe("daily");
    expect(body.data).toHaveLength(7);

    // First point should be day -7 (oldest), last should be day -1 (no today).
    expect(body.data[0].bucket).toBe(utcDayOffset(7));
    expect(body.data[body.data.length - 1].bucket).toBe(utcDayOffset(1));

    // Seeded days have their values; the rest are zero.
    const byBucket = Object.fromEntries(body.data.map((p: { bucket: string; value: number }) => [p.bucket, p.value]));
    expect(byBucket[day1]).toBe(100);
    expect(byBucket[day3]).toBe(300);
    expect(byBucket[day5]).toBe(500);
    expect(byBucket[utcDayOffset(2)]).toBe(0);
    expect(byBucket[utcDayOffset(4)]).toBe(0);
  });

  it("kind=users reads unique_users column from the same rollup row", async () => {
    const day1 = utcDayOffset(1);
    await seedRollup({
      teamId: testData.teamId,
      projectId: testData.projectId,
      appId: null,
      day: day1,
      eventCount: 1000,
      uniqueUsers: 73,
      uniqueSessions: 200,
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/stats/users/daily?days=2`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const point = body.data.find((p: { bucket: string }) => p.bucket === day1);
    expect(point?.value).toBe(73);
  });

  it("data_mode=production excludes is_dev=true rollups", async () => {
    const day = utcDayOffset(1);
    await seedRollup({
      teamId: testData.teamId,
      projectId: testData.projectId,
      appId: null,
      day,
      eventCount: 10,
      isDev: false,
    });
    await seedRollup({
      teamId: testData.teamId,
      projectId: testData.projectId,
      appId: null,
      day,
      eventCount: 99,
      isDev: true,
    });

    const prod = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/stats/events/daily?days=2&data_mode=production`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(prod.json().data.find((p: { bucket: string }) => p.bucket === day).value).toBe(10);

    const dev = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/stats/events/daily?days=2&data_mode=development`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(dev.json().data.find((p: { bucket: string }) => p.bucket === day).value).toBe(99);

    const all = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/stats/events/daily?days=2&data_mode=all`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    // 'all' sums prod + dev rollups at the same key
    expect(all.json().data.find((p: { bucket: string }) => p.bucket === day).value).toBe(109);
  });

  it("app_id filter reads the per-app row, not the project rollup", async () => {
    const day = utcDayOffset(1);
    // Project rollup row + a per-app row with different counts.
    await seedRollup({
      teamId: testData.teamId,
      projectId: testData.projectId,
      appId: null,
      day,
      eventCount: 999, // project total
    });
    await seedRollup({
      teamId: testData.teamId,
      projectId: testData.projectId,
      appId: testData.appId,
      day,
      eventCount: 42, // single-app contribution
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/stats/events/daily?days=2&app_id=${testData.appId}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.find((p: { bucket: string }) => p.bucket === day).value).toBe(42);
  });

  it("kind=funnel_completions filters by event_filter.step_name, not the human-readable step label", async () => {
    // A funnel defined with a friendly terminal label ("Onboarding Done")
    // backed by a slug step_name ("onboarding-done") used to silently zero
    // out: the reader filtered by `name` but the rollup stores the slug,
    // so the dashboard funnel sparkline flat-lined for every project.
    const day = utcDayOffset(1);
    await dbClient`
      INSERT INTO funnel_definitions (id, project_id, name, slug, steps)
      VALUES (
        gen_random_uuid(),
        ${testData.projectId},
        'Test Funnel',
        'test-funnel',
        ${dbClient.json([
          { name: "Start", event_filter: { step_name: "start" } },
          {
            name: "Onboarding Done",
            event_filter: { step_name: "onboarding-done" },
          },
        ])}::jsonb
      )
    `;
    await dbClient`
      INSERT INTO funnel_events_daily (team_id, project_id, app_id, is_dev, day, step_name, count, unique_users)
      VALUES (
        ${testData.teamId},
        ${testData.projectId},
        NULL,
        false,
        ${day},
        'onboarding-done',
        42,
        7
      )
    `;

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/stats/funnel_completions/daily?days=2`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.find((p: { bucket: string }) => p.bucket === day).value).toBe(42);
  });

  it("rejects invalid kind / grain with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${testData.projectId}/stats/nonsense/daily?days=2`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/stats/:kind/:grain (team-scoped)", () => {
  it("returns series via team_id query param", async () => {
    const day = utcDayOffset(1);
    await seedRollup({
      teamId: testData.teamId,
      projectId: testData.projectId,
      appId: null,
      day,
      eventCount: 123,
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/stats/events/daily?team_id=${testData.teamId}&days=2`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.find((p: { bucket: string }) => p.bucket === day).value).toBe(123);
  });
});
