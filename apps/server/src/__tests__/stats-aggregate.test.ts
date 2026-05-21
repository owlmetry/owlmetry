import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, isNull } from "drizzle-orm";
import {
  apps,
  teams,
  teamMembers,
  users,
  projects,
  eventsDaily,
  eventsHourly,
  metricEventsDaily,
  funnelEventsDaily,
  questionnaireResponsesDaily,
  questionnaires,
  questionnaireResponses,
  schema,
} from "@owlmetry/db";
import {
  statsAggregateDailyHandler,
  statsAggregateHourlyHandler,
} from "../jobs/stats-aggregate.js";
import { TEST_DB_URL } from "./setup.js";
import { ensurePartitionsForDates } from "@owlmetry/db";

const dbClient = postgres(TEST_DB_URL, { max: 1 });
const db = drizzle(dbClient, { schema });

let teamId: string;
let projectId: string;
let appAId: string;
let appBId: string;
let userId: string;
let questionnaireId: string;

function makeCtx() {
  return {
    runId: "test-stats-run",
    updateProgress: async () => {},
    isCancelled: () => false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    db,
    createClient: () => postgres(TEST_DB_URL, { max: 1 }),
    emailService: undefined,
  };
}

beforeAll(async () => {
  const [team] = await db
    .insert(teams)
    .values({ name: "Stats Agg Test", slug: `stats-${Date.now()}` })
    .returning({ id: teams.id });
  teamId = team.id;
  const [project] = await db
    .insert(projects)
    .values({ team_id: teamId, name: "Stats P", slug: `stats-p-${Date.now()}`, color: "#abcabc" })
    .returning({ id: projects.id });
  projectId = project.id;
  const [user] = await db
    .insert(users)
    .values({ email: `stats-${Date.now()}@example.com`, name: "Stats" })
    .returning({ id: users.id });
  userId = user.id;
  await db.insert(teamMembers).values({ team_id: teamId, user_id: userId, role: "owner" });

  const [appA] = await db
    .insert(apps)
    .values({
      team_id: teamId,
      project_id: projectId,
      name: "Stats A",
      platform: "apple",
      bundle_id: `com.example.stats.a.${Date.now()}`,
    })
    .returning({ id: apps.id });
  appAId = appA.id;
  const [appB] = await db
    .insert(apps)
    .values({
      team_id: teamId,
      project_id: projectId,
      name: "Stats B",
      platform: "apple",
      bundle_id: `com.example.stats.b.${Date.now()}`,
    })
    .returning({ id: apps.id });
  appBId = appB.id;

  const [q] = await db
    .insert(questionnaires)
    .values({
      project_id: projectId,
      app_id: appAId,
      slug: "stats-q",
      name: "Stats Questionnaire",
      schema: { version: 1, questions: [] },
      is_active: true,
    })
    .returning({ id: questionnaires.id });
  questionnaireId = q.id;
});

beforeEach(async () => {
  // Wipe rollups + sources so each test starts from a clean state. The
  // partitioned event tables can't be deleted via Drizzle .delete() without
  // FK gymnastics, so use raw SQL.
  await dbClient`DELETE FROM events_daily WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM events_hourly WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM metric_events_daily WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM metric_events_hourly WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM funnel_events_daily WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM funnel_events_hourly WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM questionnaire_responses_daily WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM questionnaire_responses_hourly WHERE project_id = ${projectId}`;

  await dbClient`DELETE FROM events WHERE app_id IN (${appAId}, ${appBId})`;
  await dbClient`DELETE FROM metric_events WHERE app_id IN (${appAId}, ${appBId})`;
  await dbClient`DELETE FROM funnel_events WHERE app_id IN (${appAId}, ${appBId})`;
  await dbClient`DELETE FROM questionnaire_responses WHERE project_id = ${projectId}`;
});

afterAll(async () => {
  await dbClient`DELETE FROM events_daily WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM events_hourly WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM metric_events_daily WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM metric_events_hourly WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM funnel_events_daily WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM funnel_events_hourly WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM questionnaire_responses_daily WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM questionnaire_responses_hourly WHERE project_id = ${projectId}`;
  await dbClient`DELETE FROM events WHERE app_id IN (${appAId}, ${appBId})`;
  await dbClient`DELETE FROM metric_events WHERE app_id IN (${appAId}, ${appBId})`;
  await dbClient`DELETE FROM funnel_events WHERE app_id IN (${appAId}, ${appBId})`;
  await dbClient`DELETE FROM questionnaire_responses WHERE project_id = ${projectId}`;
  await db.delete(questionnaires).where(eq(questionnaires.id, questionnaireId));
  await db.delete(apps).where(eq(apps.id, appAId));
  await db.delete(apps).where(eq(apps.id, appBId));
  await db.delete(teamMembers).where(eq(teamMembers.team_id, teamId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(projects).where(eq(projects.team_id, teamId));
  await db.delete(teams).where(eq(teams.id, teamId));
  await dbClient.end();
});

// Anchor every test at a stable past day so the trailing-window default
// doesn't drift between runs. 5 days in the past so the trailing-3-day
// default doesn't reach into our seeded buckets except via explicit start/end.
function dayAt(daysAgo: number): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  return d;
}

async function seedEvent(opts: {
  appId: string;
  userId: string;
  sessionId: string;
  isDev: boolean;
  timestamp: Date;
  level?: string;
}) {
  await ensurePartitionsForDates(dbClient, [opts.timestamp]);
  await dbClient.unsafe(
    `INSERT INTO events (app_id, session_id, user_id, level, message, is_dev, timestamp)
     VALUES ($1, $2, $3, $4::log_level, 'test', $5, $6)`,
    [opts.appId, opts.sessionId, opts.userId, opts.level ?? "info", opts.isDev, opts.timestamp.toISOString()],
  );
}

describe("statsAggregateDailyHandler — events", () => {
  it("aggregates per-app rows and a project rollup with project-level distincts", async () => {
    // Day -5: 3 events from app A (2 users, 2 sessions), 2 events from app B (1 user, 2 sessions).
    // user-1 appears on BOTH apps — the rollup should distinct them down to 2 users overall, not 3.
    const day = dayAt(5);
    const ts = (h: number) => new Date(day.getTime() + h * 3_600_000);
    await Promise.all([
      seedEvent({ appId: appAId, userId: "user-1", sessionId: "11111111-0000-0000-0000-000000000001", isDev: false, timestamp: ts(1) }),
      seedEvent({ appId: appAId, userId: "user-1", sessionId: "11111111-0000-0000-0000-000000000001", isDev: false, timestamp: ts(2) }),
      seedEvent({ appId: appAId, userId: "user-2", sessionId: "11111111-0000-0000-0000-000000000002", isDev: false, timestamp: ts(3) }),
      seedEvent({ appId: appBId, userId: "user-1", sessionId: "22222222-0000-0000-0000-000000000001", isDev: false, timestamp: ts(4) }),
      seedEvent({ appId: appBId, userId: "user-3", sessionId: "22222222-0000-0000-0000-000000000002", isDev: false, timestamp: ts(5) }),
    ]);

    const ctx = makeCtx();
    const dayStr = day.toISOString().slice(0, 10);
    const result = await statsAggregateDailyHandler(ctx, {
      start: dayStr,
      end: dayStr,
      project_id: projectId,
    });

    expect(result.events_per_app_rows).toBeGreaterThan(0);
    expect(result.events_rollup_rows).toBeGreaterThan(0);

    const perAppRows = await db
      .select()
      .from(eventsDaily)
      .where(and(eq(eventsDaily.project_id, projectId), eq(eventsDaily.day, dayStr)));
    const rollup = perAppRows.find((r) => r.app_id === null);
    const appA = perAppRows.find((r) => r.app_id === appAId);
    const appB = perAppRows.find((r) => r.app_id === appBId);
    expect(rollup).toBeTruthy();
    expect(appA).toBeTruthy();
    expect(appB).toBeTruthy();

    expect(appA!.event_count).toBe(3);
    expect(appA!.unique_users).toBe(2);
    expect(appA!.unique_sessions).toBe(2);

    expect(appB!.event_count).toBe(2);
    expect(appB!.unique_users).toBe(2);
    expect(appB!.unique_sessions).toBe(2);

    // Project rollup: 5 total events, 3 distinct users (user-1, user-2, user-3),
    // 4 distinct sessions. The sum-of-app distincts would be 4 users (2+2) —
    // the rollup must avoid that double-counting.
    expect(rollup!.event_count).toBe(5);
    expect(rollup!.unique_users).toBe(3);
    expect(rollup!.unique_sessions).toBe(4);
  });

  it("is idempotent — running twice yields the same row count and values", async () => {
    const day = dayAt(5);
    const dayStr = day.toISOString().slice(0, 10);
    await seedEvent({ appId: appAId, userId: "u1", sessionId: "33333333-0000-0000-0000-000000000001", isDev: false, timestamp: new Date(day.getTime() + 3_600_000) });
    await seedEvent({ appId: appAId, userId: "u2", sessionId: "33333333-0000-0000-0000-000000000002", isDev: false, timestamp: new Date(day.getTime() + 7_200_000) });

    const ctx = makeCtx();
    await statsAggregateDailyHandler(ctx, { start: dayStr, end: dayStr, project_id: projectId });
    const firstPass = await db
      .select()
      .from(eventsDaily)
      .where(and(eq(eventsDaily.project_id, projectId), eq(eventsDaily.day, dayStr)));
    await statsAggregateDailyHandler(ctx, { start: dayStr, end: dayStr, project_id: projectId });
    const secondPass = await db
      .select()
      .from(eventsDaily)
      .where(and(eq(eventsDaily.project_id, projectId), eq(eventsDaily.day, dayStr)));

    expect(secondPass.length).toBe(firstPass.length);
    for (const f of firstPass) {
      const s = secondPass.find((r) => r.app_id === f.app_id && r.is_dev === f.is_dev);
      expect(s, `missing matching row on second pass for app_id=${f.app_id}`).toBeTruthy();
      expect(s!.event_count).toBe(f.event_count);
      expect(s!.unique_users).toBe(f.unique_users);
      expect(s!.unique_sessions).toBe(f.unique_sessions);
    }
  });

  it("splits is_dev=true and is_dev=false into separate rows; project rollup equals sum-of-per-app event_count when only one app contributes", async () => {
    const day = dayAt(5);
    const dayStr = day.toISOString().slice(0, 10);
    await seedEvent({ appId: appAId, userId: "u-prod", sessionId: "44444444-0000-0000-0000-000000000001", isDev: false, timestamp: new Date(day.getTime() + 3_600_000) });
    await seedEvent({ appId: appAId, userId: "u-dev", sessionId: "44444444-0000-0000-0000-000000000002", isDev: true, timestamp: new Date(day.getTime() + 3_600_000) });

    const ctx = makeCtx();
    await statsAggregateDailyHandler(ctx, { start: dayStr, end: dayStr, project_id: projectId });

    const rows = await db
      .select()
      .from(eventsDaily)
      .where(and(eq(eventsDaily.project_id, projectId), eq(eventsDaily.day, dayStr)));

    const prodRollup = rows.find((r) => r.app_id === null && r.is_dev === false);
    const devRollup = rows.find((r) => r.app_id === null && r.is_dev === true);
    expect(prodRollup?.event_count).toBe(1);
    expect(devRollup?.event_count).toBe(1);
  });

  it("counts error events into error_count", async () => {
    const day = dayAt(5);
    const dayStr = day.toISOString().slice(0, 10);
    await seedEvent({ appId: appAId, userId: "u1", sessionId: "55555555-0000-0000-0000-000000000001", isDev: false, timestamp: new Date(day.getTime() + 3_600_000), level: "error" });
    await seedEvent({ appId: appAId, userId: "u2", sessionId: "55555555-0000-0000-0000-000000000002", isDev: false, timestamp: new Date(day.getTime() + 3_600_000), level: "info" });

    const ctx = makeCtx();
    await statsAggregateDailyHandler(ctx, { start: dayStr, end: dayStr, project_id: projectId });

    const [rollup] = await db
      .select()
      .from(eventsDaily)
      .where(
        and(
          eq(eventsDaily.project_id, projectId),
          eq(eventsDaily.day, dayStr),
          isNull(eventsDaily.app_id),
          eq(eventsDaily.is_dev, false),
        ),
      );
    expect(rollup.error_count).toBe(1);
    expect(rollup.event_count).toBe(2);
  });
});

describe("statsAggregateHourlyHandler — events", () => {
  it("buckets events into hour-granularity rows", async () => {
    const day = dayAt(5);
    const hour0 = new Date(day.getTime()); // 00:00 UTC
    const hour1 = new Date(day.getTime() + 3_600_000);

    await seedEvent({ appId: appAId, userId: "u1", sessionId: "66666666-0000-0000-0000-000000000001", isDev: false, timestamp: new Date(hour0.getTime() + 60_000) });
    await seedEvent({ appId: appAId, userId: "u1", sessionId: "66666666-0000-0000-0000-000000000001", isDev: false, timestamp: new Date(hour1.getTime() + 60_000) });

    const ctx = makeCtx();
    await statsAggregateHourlyHandler(ctx, {
      start: hour0.toISOString(),
      end: hour1.toISOString(),
      project_id: projectId,
    });

    const rows = await db
      .select()
      .from(eventsHourly)
      .where(and(eq(eventsHourly.project_id, projectId), isNull(eventsHourly.app_id)));
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.event_count).toBe(1);
    }
  });
});

describe("statsAggregateDailyHandler — questionnaire responses", () => {
  it("counts submitted vs draft separately and re-aggregation drops stale draft counts when a draft is submitted", async () => {
    const dayA = dayAt(5);
    const dayB = dayAt(4);
    const dayAStr = dayA.toISOString().slice(0, 10);
    const dayBStr = dayB.toISOString().slice(0, 10);

    // Day A: a draft is created.
    const draftRows = await dbClient.unsafe<Array<{ id: string }>>(
      `INSERT INTO questionnaire_responses (questionnaire_id, slug, app_id, project_id, answers, status, is_dev, created_at, updated_at)
       VALUES ($1, 'stats-q', $2, $3, '{}'::jsonb, 'draft', false, $4, $4)
       RETURNING id`,
      [questionnaireId, appAId, projectId, dayA.toISOString()],
    );
    const draft = draftRows[0];

    const ctx = makeCtx();
    await statsAggregateDailyHandler(ctx, { start: dayAStr, end: dayBStr, project_id: projectId });
    const beforeRows = await db
      .select()
      .from(questionnaireResponsesDaily)
      .where(
        and(
          eq(questionnaireResponsesDaily.project_id, projectId),
          eq(questionnaireResponsesDaily.day, dayAStr),
          isNull(questionnaireResponsesDaily.app_id),
        ),
      );
    expect(beforeRows.length).toBe(1);
    expect(beforeRows[0].draft_count).toBe(1);
    expect(beforeRows[0].submitted_count).toBe(0);

    // Day B: the draft is submitted (submitted_at flips). Re-aggregating both
    // days should now show draft_count=0 on day A (the row no longer matches
    // submitted_at IS NULL) and submitted_count=1 on day B.
    await dbClient.unsafe(
      `UPDATE questionnaire_responses
       SET submitted_at = $1, status = 'new', updated_at = $1
       WHERE id = $2`,
      [dayB.toISOString(), draft.id],
    );
    await statsAggregateDailyHandler(ctx, { start: dayAStr, end: dayBStr, project_id: projectId });

    const dayAAfter = await db
      .select()
      .from(questionnaireResponsesDaily)
      .where(
        and(
          eq(questionnaireResponsesDaily.project_id, projectId),
          eq(questionnaireResponsesDaily.day, dayAStr),
          isNull(questionnaireResponsesDaily.app_id),
        ),
      );
    // DELETE-then-INSERT semantics: after the draft is submitted, day A has
    // no matching source rows, so its rollup row is wiped entirely (rather
    // than being kept around with all-zero counters).
    expect(dayAAfter.length).toBe(0);

    const dayBAfter = await db
      .select()
      .from(questionnaireResponsesDaily)
      .where(
        and(
          eq(questionnaireResponsesDaily.project_id, projectId),
          eq(questionnaireResponsesDaily.day, dayBStr),
          isNull(questionnaireResponsesDaily.app_id),
        ),
      );
    expect(dayBAfter[0].submitted_count).toBe(1);
    expect(dayBAfter[0].draft_count).toBe(0);
  });
});

describe("statsAggregateDailyHandler — metric/funnel events", () => {
  it("aggregates metric_events with metric_slug + phase dimensions", async () => {
    const day = dayAt(5);
    const dayStr = day.toISOString().slice(0, 10);

    await ensurePartitionsForDates(dbClient, [day]);
    await dbClient.unsafe(
      `INSERT INTO metric_events (app_id, session_id, metric_slug, phase, is_dev, timestamp)
       VALUES
         ($1, '77777777-0000-0000-0000-000000000001', 'page-load', 'complete', false, $2),
         ($1, '77777777-0000-0000-0000-000000000002', 'page-load', 'complete', false, $3),
         ($1, '77777777-0000-0000-0000-000000000003', 'page-load', 'fail',     false, $4)`,
      [
        appAId,
        new Date(day.getTime() + 3_600_000).toISOString(),
        new Date(day.getTime() + 7_200_000).toISOString(),
        new Date(day.getTime() + 10_800_000).toISOString(),
      ],
    );

    const ctx = makeCtx();
    await statsAggregateDailyHandler(ctx, { start: dayStr, end: dayStr, project_id: projectId });

    const rows = await db
      .select()
      .from(metricEventsDaily)
      .where(
        and(
          eq(metricEventsDaily.project_id, projectId),
          eq(metricEventsDaily.day, dayStr),
          isNull(metricEventsDaily.app_id),
        ),
      );
    const byPhase = Object.fromEntries(rows.map((r) => [r.phase, r.count]));
    expect(byPhase.complete).toBe(2);
    expect(byPhase.fail).toBe(1);
  });

  it("aggregates funnel_events with step_name dimension", async () => {
    const day = dayAt(5);
    const dayStr = day.toISOString().slice(0, 10);

    await ensurePartitionsForDates(dbClient, [day]);
    await dbClient.unsafe(
      `INSERT INTO funnel_events (app_id, session_id, step_name, user_id, message, is_dev, timestamp)
       VALUES
         ($1, '88888888-0000-0000-0000-000000000001', 'step-1', 'user-1', '', false, $2),
         ($1, '88888888-0000-0000-0000-000000000002', 'step-1', 'user-2', '', false, $3),
         ($1, '88888888-0000-0000-0000-000000000003', 'step-2', 'user-1', '', false, $4)`,
      [
        appAId,
        new Date(day.getTime() + 3_600_000).toISOString(),
        new Date(day.getTime() + 7_200_000).toISOString(),
        new Date(day.getTime() + 10_800_000).toISOString(),
      ],
    );

    const ctx = makeCtx();
    await statsAggregateDailyHandler(ctx, { start: dayStr, end: dayStr, project_id: projectId });

    const rows = await db
      .select()
      .from(funnelEventsDaily)
      .where(
        and(
          eq(funnelEventsDaily.project_id, projectId),
          eq(funnelEventsDaily.day, dayStr),
          isNull(funnelEventsDaily.app_id),
        ),
      );
    const byStep = Object.fromEntries(rows.map((r) => [r.step_name, r.count]));
    expect(byStep["step-1"]).toBe(2);
    expect(byStep["step-2"]).toBe(1);
  });
});
