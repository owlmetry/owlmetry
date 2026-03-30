import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { enforceRetentionForProject } from "@owlmetry/db";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let testData: {
  userId: string;
  teamId: string;
  projectId: string;
  appId: string;
  backendProjectId: string;
  backendAppId: string;
};

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  testData = await seedTestData();
});

afterAll(async () => {
  await app.close();
});

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** Create partition for the month containing the given date, for all 3 event tables. */
async function ensurePartitionForDate(client: postgres.Sql, date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const nextMonth = new Date(year, date.getMonth() + 1, 1);
  const nextYear = nextMonth.getFullYear();
  const nextMo = String(nextMonth.getMonth() + 1).padStart(2, "0");
  const from = `${year}-${month}-01`;
  const to = `${nextYear}-${nextMo}-01`;

  for (const table of ["events", "metric_events", "funnel_events"]) {
    const partitionName = `${table}_${year}_${month}`;
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS ${partitionName}
        PARTITION OF ${table}
        FOR VALUES FROM ('${from}') TO ('${to}')
    `);
  }
}

async function insertTestEvent(client: postgres.Sql, appId: string, timestamp: Date, message = "test") {
  await ensurePartitionForDate(client, timestamp);
  await client.unsafe(
    `INSERT INTO events (app_id, level, message, session_id, environment, timestamp, received_at)
     VALUES ($1, 'info', $2, $3, 'ios', $4, NOW())`,
    [appId, message, crypto.randomUUID(), timestamp]
  );
}

async function insertTestMetricEvent(client: postgres.Sql, appId: string, timestamp: Date, slug = "test-metric") {
  await ensurePartitionForDate(client, timestamp);
  await client.unsafe(
    `INSERT INTO metric_events (app_id, metric_slug, phase, session_id, environment, timestamp, received_at)
     VALUES ($1, $2, 'complete', $3, 'ios', $4, NOW())`,
    [appId, slug, crypto.randomUUID(), timestamp]
  );
}

async function insertTestFunnelEvent(client: postgres.Sql, appId: string, timestamp: Date, stepName = "step-1") {
  await ensurePartitionForDate(client, timestamp);
  await client.unsafe(
    `INSERT INTO funnel_events (app_id, step_name, message, session_id, environment, timestamp, received_at)
     VALUES ($1, $2, $3, $4, 'ios', $5, NOW())`,
    [appId, stepName, stepName, crypto.randomUUID(), timestamp]
  );
}

describe("enforceRetentionForProject", () => {
  it("deletes events older than the retention cutoff", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });

    // Insert old event (150 days ago) and recent event (10 days ago)
    await insertTestEvent(client, testData.appId, daysAgo(150), "old event");
    await insertTestEvent(client, testData.appId, daysAgo(10), "recent event");

    const result = await enforceRetentionForProject(client, {
      projectId: testData.projectId,
      appIds: [testData.appId],
      retentionDaysEvents: 120,
      retentionDaysMetrics: 365,
      retentionDaysFunnels: 365,
    });

    expect(result.eventsDeleted).toBe(1);
    expect(result.metricEventsDeleted).toBe(0);
    expect(result.funnelEventsDeleted).toBe(0);

    // Verify: old event gone, recent event remains
    const remaining = await client.unsafe(`SELECT message FROM events WHERE app_id = $1`, [testData.appId]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe("recent event");

    await client.end();
  });

  it("deletes metric events older than the retention cutoff", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });

    await insertTestMetricEvent(client, testData.appId, daysAgo(400));
    await insertTestMetricEvent(client, testData.appId, daysAgo(30));

    const result = await enforceRetentionForProject(client, {
      projectId: testData.projectId,
      appIds: [testData.appId],
      retentionDaysEvents: 120,
      retentionDaysMetrics: 365,
      retentionDaysFunnels: 365,
    });

    expect(result.metricEventsDeleted).toBe(1);

    const remaining = await client.unsafe(`SELECT id FROM metric_events WHERE app_id = $1`, [testData.appId]);
    expect(remaining).toHaveLength(1);

    await client.end();
  });

  it("deletes funnel events older than the retention cutoff", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });

    await insertTestFunnelEvent(client, testData.appId, daysAgo(400));
    await insertTestFunnelEvent(client, testData.appId, daysAgo(30));

    const result = await enforceRetentionForProject(client, {
      projectId: testData.projectId,
      appIds: [testData.appId],
      retentionDaysEvents: 120,
      retentionDaysMetrics: 365,
      retentionDaysFunnels: 365,
    });

    expect(result.funnelEventsDeleted).toBe(1);

    const remaining = await client.unsafe(`SELECT id FROM funnel_events WHERE app_id = $1`, [testData.appId]);
    expect(remaining).toHaveLength(1);

    await client.end();
  });

  it("leaves events for other projects untouched", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });

    // Insert old events in both projects
    await insertTestEvent(client, testData.appId, daysAgo(150), "project-1 old");
    await insertTestEvent(client, testData.backendAppId, daysAgo(150), "project-2 old");

    // Only enforce retention on project 1
    const result = await enforceRetentionForProject(client, {
      projectId: testData.projectId,
      appIds: [testData.appId],
      retentionDaysEvents: 120,
      retentionDaysMetrics: 365,
      retentionDaysFunnels: 365,
    });

    expect(result.eventsDeleted).toBe(1);

    // Project 2's event should still be there
    const remaining = await client.unsafe(`SELECT message FROM events WHERE app_id = $1`, [testData.backendAppId]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe("project-2 old");

    await client.end();
  });

  it("respects per-project retention settings", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });

    // Insert events 50 days ago in both projects
    await insertTestEvent(client, testData.appId, daysAgo(50), "project-1");
    await insertTestEvent(client, testData.backendAppId, daysAgo(50), "project-2");

    // Project 1: 30-day retention (should delete)
    const result1 = await enforceRetentionForProject(client, {
      projectId: testData.projectId,
      appIds: [testData.appId],
      retentionDaysEvents: 30,
      retentionDaysMetrics: 365,
      retentionDaysFunnels: 365,
    });
    expect(result1.eventsDeleted).toBe(1);

    // Project 2: 120-day retention (should keep)
    const result2 = await enforceRetentionForProject(client, {
      projectId: testData.backendProjectId,
      appIds: [testData.backendAppId],
      retentionDaysEvents: 120,
      retentionDaysMetrics: 365,
      retentionDaysFunnels: 365,
    });
    expect(result2.eventsDeleted).toBe(0);

    await client.end();
  });

  it("returns zero counts when no events are past retention", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });

    // Insert only recent events
    await insertTestEvent(client, testData.appId, daysAgo(10));
    await insertTestMetricEvent(client, testData.appId, daysAgo(10));
    await insertTestFunnelEvent(client, testData.appId, daysAgo(10));

    const result = await enforceRetentionForProject(client, {
      projectId: testData.projectId,
      appIds: [testData.appId],
      retentionDaysEvents: 120,
      retentionDaysMetrics: 365,
      retentionDaysFunnels: 365,
    });

    expect(result.eventsDeleted).toBe(0);
    expect(result.metricEventsDeleted).toBe(0);
    expect(result.funnelEventsDeleted).toBe(0);

    await client.end();
  });

  it("returns zero when no apps in project", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });

    const result = await enforceRetentionForProject(client, {
      projectId: testData.projectId,
      appIds: [],
      retentionDaysEvents: 120,
      retentionDaysMetrics: 365,
      retentionDaysFunnels: 365,
    });

    expect(result.eventsDeleted).toBe(0);
    expect(result.metricEventsDeleted).toBe(0);
    expect(result.funnelEventsDeleted).toBe(0);

    await client.end();
  });
});
