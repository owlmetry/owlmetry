import type { JobHandler } from "../services/job-runner.js";
import type postgres from "postgres";

// Re-aggregate this many trailing buckets when no explicit range is provided.
// 72h covers ~the 99.9th percentile of mobile SDK arrival latency (offline
// buffering can stretch real arrivals out for a day or two). Larger windows
// just cost more SQL with no observable correctness gain.
const TRAILING_BUCKETS_DEFAULT = 3;

type Grain = "day" | "hour";

interface BucketRange {
  start: Date;
  endExclusive: Date;
}

/**
 * Resolve a date range from job params. Modes:
 *
 *   - `start` + `end` set → backfill that explicit range (inclusive).
 *   - Otherwise → re-aggregate the trailing `TRAILING_BUCKETS_DEFAULT` buckets
 *     ending at `now()` (so an hourly run started 5 min past the hour
 *     re-aggregates the last 3 fully-completed hours and the in-progress one
 *     — the in-progress one will be re-aggregated again next run).
 *
 * UTC throughout. Returns a half-open range `[start, endExclusive)` regardless
 * of how `end` was specified, so the SQL `WHERE ts >= start AND ts < end`
 * doesn't need to know which mode the caller used.
 */
function resolveRange(grain: Grain, params: Record<string, unknown>): BucketRange {
  const rawStart = typeof params.start === "string" ? params.start : null;
  const rawEnd = typeof params.end === "string" ? params.end : null;

  if (rawStart && rawEnd) {
    const start = parseInput(grain, rawStart);
    const endInclusive = parseInput(grain, rawEnd);
    if (start === null || endInclusive === null) {
      throw new Error(`Invalid start/end (${rawStart} / ${rawEnd}). Expected ${grain === "day" ? "YYYY-MM-DD" : "ISO 8601 datetime"}.`);
    }
    return { start, endExclusive: addBuckets(grain, endInclusive, 1) };
  }

  // Trailing window. Anchor on the current bucket's start so a re-aggregation
  // includes the in-flight bucket (we'd rather over-write a partial bucket than
  // miss one because the cron fired one second before the boundary).
  const now = new Date();
  const currentBucketStart = truncateToBucket(grain, now);
  const start = addBuckets(grain, currentBucketStart, -(TRAILING_BUCKETS_DEFAULT - 1));
  const endExclusive = addBuckets(grain, currentBucketStart, 1);
  return { start, endExclusive };
}

function parseInput(grain: Grain, value: string): Date | null {
  if (grain === "day") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return truncateToBucket("hour", d);
}

function truncateToBucket(grain: Grain, d: Date): Date {
  if (grain === "day") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
  ));
}

function addBuckets(grain: Grain, d: Date, n: number): Date {
  const r = new Date(d);
  if (grain === "day") r.setUTCDate(r.getUTCDate() + n);
  else r.setUTCHours(r.getUTCHours() + n);
  return r;
}

function bucketCount(grain: Grain, range: BucketRange): number {
  const ms = range.endExclusive.getTime() - range.start.getTime();
  const per = grain === "day" ? 86_400_000 : 3_600_000;
  return Math.round(ms / per);
}

/**
 * Per-kind aggregator. DELETE-then-INSERT semantics inside a single
 * transaction:
 *
 *   1. DELETE every existing row in the bucket range for the in-scope
 *      project(s). Wipes stale state — e.g. a questionnaire draft that's
 *      since been submitted, an app that's been soft-deleted, an event whose
 *      retention has lapsed.
 *   2. INSERT per-app rows + INSERT a project-rollup row (app_id NULL) from
 *      the current state of the source tables. Rollup distincts are
 *      project-level (no app GROUP BY), so two users active on two apps
 *      count as one in the rollup but two in the per-app rows.
 *
 * Atomic: an in-flight read either sees the old rows or the new ones, never
 * a half-emptied range. Concurrent runs of the same range serialize on the
 * table locks; the second wins.
 *
 * `apps.deleted_at IS NULL` is enforced in every join so soft-deleted apps
 * stop contributing to new buckets without a separate cleanup pass.
 */
async function aggregateEvents(
  client: postgres.Sql,
  grain: Grain,
  range: BucketRange,
  projectId: string | null,
): Promise<{ perAppRows: number; rollupRows: number }> {
  const table = grain === "day" ? "events_daily" : "events_hourly";
  const bucketCol = grain === "day" ? "day" : "hour";
  const bucketCast = grain === "day" ? "::date" : "";
  const startIso = range.start.toISOString();
  const endIso = range.endExclusive.toISOString();

  return client.begin(async (sql) => {
    await sql.unsafe(
      `DELETE FROM ${table}
       WHERE ${bucketCol} >= $1${bucketCast} AND ${bucketCol} < $2${bucketCast}
         AND ($3::uuid IS NULL OR project_id = $3)`,
      [startIso, endIso, projectId],
    );

    const perApp = await sql.unsafe(
      `INSERT INTO ${table} (team_id, project_id, app_id, is_dev, ${bucketCol}, event_count, unique_users, unique_sessions, error_count)
       SELECT
         a.team_id,
         a.project_id,
         e.app_id,
         e.is_dev,
         date_trunc('${grain}', e.timestamp)${bucketCast},
         COUNT(*)::int,
         COUNT(DISTINCT e.user_id)::int,
         COUNT(DISTINCT e.session_id)::int,
         COUNT(*) FILTER (WHERE e.level = 'error')::int
       FROM events e
       JOIN apps a ON a.id = e.app_id AND a.deleted_at IS NULL
       WHERE e.timestamp >= $1 AND e.timestamp < $2
         AND ($3::uuid IS NULL OR a.project_id = $3)
       GROUP BY a.team_id, a.project_id, e.app_id, e.is_dev, date_trunc('${grain}', e.timestamp)`,
      [startIso, endIso, projectId],
    );

    const rollup = await sql.unsafe(
      `INSERT INTO ${table} (team_id, project_id, app_id, is_dev, ${bucketCol}, event_count, unique_users, unique_sessions, error_count)
       SELECT
         a.team_id,
         a.project_id,
         NULL,
         e.is_dev,
         date_trunc('${grain}', e.timestamp)${bucketCast},
         COUNT(*)::int,
         COUNT(DISTINCT e.user_id)::int,
         COUNT(DISTINCT e.session_id)::int,
         COUNT(*) FILTER (WHERE e.level = 'error')::int
       FROM events e
       JOIN apps a ON a.id = e.app_id AND a.deleted_at IS NULL
       WHERE e.timestamp >= $1 AND e.timestamp < $2
         AND ($3::uuid IS NULL OR a.project_id = $3)
       GROUP BY a.team_id, a.project_id, e.is_dev, date_trunc('${grain}', e.timestamp)`,
      [startIso, endIso, projectId],
    );

    return { perAppRows: perApp.count ?? 0, rollupRows: rollup.count ?? 0 };
  }) as Promise<{ perAppRows: number; rollupRows: number }>;
}

async function aggregateMetricEvents(
  client: postgres.Sql,
  grain: Grain,
  range: BucketRange,
  projectId: string | null,
): Promise<{ perAppRows: number; rollupRows: number }> {
  const table = grain === "day" ? "metric_events_daily" : "metric_events_hourly";
  const bucketCol = grain === "day" ? "day" : "hour";
  const bucketCast = grain === "day" ? "::date" : "";
  const startIso = range.start.toISOString();
  const endIso = range.endExclusive.toISOString();

  return client.begin(async (sql) => {
    await sql.unsafe(
      `DELETE FROM ${table}
       WHERE ${bucketCol} >= $1${bucketCast} AND ${bucketCol} < $2${bucketCast}
         AND ($3::uuid IS NULL OR project_id = $3)`,
      [startIso, endIso, projectId],
    );

    const perApp = await sql.unsafe(
      `INSERT INTO ${table} (team_id, project_id, app_id, is_dev, ${bucketCol}, metric_slug, phase, count, sum_duration_ms)
       SELECT
         a.team_id,
         a.project_id,
         m.app_id,
         m.is_dev,
         date_trunc('${grain}', m.timestamp)${bucketCast},
         m.metric_slug,
         m.phase,
         COUNT(*)::int,
         SUM(m.duration_ms)::bigint
       FROM metric_events m
       JOIN apps a ON a.id = m.app_id AND a.deleted_at IS NULL
       WHERE m.timestamp >= $1 AND m.timestamp < $2
         AND ($3::uuid IS NULL OR a.project_id = $3)
       GROUP BY a.team_id, a.project_id, m.app_id, m.is_dev, date_trunc('${grain}', m.timestamp), m.metric_slug, m.phase`,
      [startIso, endIso, projectId],
    );

    const rollup = await sql.unsafe(
      `INSERT INTO ${table} (team_id, project_id, app_id, is_dev, ${bucketCol}, metric_slug, phase, count, sum_duration_ms)
       SELECT
         a.team_id,
         a.project_id,
         NULL,
         m.is_dev,
         date_trunc('${grain}', m.timestamp)${bucketCast},
         m.metric_slug,
         m.phase,
         COUNT(*)::int,
         SUM(m.duration_ms)::bigint
       FROM metric_events m
       JOIN apps a ON a.id = m.app_id AND a.deleted_at IS NULL
       WHERE m.timestamp >= $1 AND m.timestamp < $2
         AND ($3::uuid IS NULL OR a.project_id = $3)
       GROUP BY a.team_id, a.project_id, m.is_dev, date_trunc('${grain}', m.timestamp), m.metric_slug, m.phase`,
      [startIso, endIso, projectId],
    );

    return { perAppRows: perApp.count ?? 0, rollupRows: rollup.count ?? 0 };
  }) as Promise<{ perAppRows: number; rollupRows: number }>;
}

async function aggregateFunnelEvents(
  client: postgres.Sql,
  grain: Grain,
  range: BucketRange,
  projectId: string | null,
): Promise<{ perAppRows: number; rollupRows: number }> {
  const table = grain === "day" ? "funnel_events_daily" : "funnel_events_hourly";
  const bucketCol = grain === "day" ? "day" : "hour";
  const bucketCast = grain === "day" ? "::date" : "";
  const startIso = range.start.toISOString();
  const endIso = range.endExclusive.toISOString();

  return client.begin(async (sql) => {
    await sql.unsafe(
      `DELETE FROM ${table}
       WHERE ${bucketCol} >= $1${bucketCast} AND ${bucketCol} < $2${bucketCast}
         AND ($3::uuid IS NULL OR project_id = $3)`,
      [startIso, endIso, projectId],
    );

    const perApp = await sql.unsafe(
      `INSERT INTO ${table} (team_id, project_id, app_id, is_dev, ${bucketCol}, step_name, count, unique_users)
       SELECT
         a.team_id,
         a.project_id,
         f.app_id,
         f.is_dev,
         date_trunc('${grain}', f.timestamp)${bucketCast},
         f.step_name,
         COUNT(*)::int,
         COUNT(DISTINCT f.user_id)::int
       FROM funnel_events f
       JOIN apps a ON a.id = f.app_id AND a.deleted_at IS NULL
       WHERE f.timestamp >= $1 AND f.timestamp < $2
         AND ($3::uuid IS NULL OR a.project_id = $3)
       GROUP BY a.team_id, a.project_id, f.app_id, f.is_dev, date_trunc('${grain}', f.timestamp), f.step_name`,
      [startIso, endIso, projectId],
    );

    const rollup = await sql.unsafe(
      `INSERT INTO ${table} (team_id, project_id, app_id, is_dev, ${bucketCol}, step_name, count, unique_users)
       SELECT
         a.team_id,
         a.project_id,
         NULL,
         f.is_dev,
         date_trunc('${grain}', f.timestamp)${bucketCast},
         f.step_name,
         COUNT(*)::int,
         COUNT(DISTINCT f.user_id)::int
       FROM funnel_events f
       JOIN apps a ON a.id = f.app_id AND a.deleted_at IS NULL
       WHERE f.timestamp >= $1 AND f.timestamp < $2
         AND ($3::uuid IS NULL OR a.project_id = $3)
       GROUP BY a.team_id, a.project_id, f.is_dev, date_trunc('${grain}', f.timestamp), f.step_name`,
      [startIso, endIso, projectId],
    );

    return { perAppRows: perApp.count ?? 0, rollupRows: rollup.count ?? 0 };
  }) as Promise<{ perAppRows: number; rollupRows: number }>;
}

/**
 * Two-axis aggregation: a response can transition draft → submitted across
 * buckets. `submitted_count` keys on `submitted_at`; `draft_count` keys on
 * `created_at` AND filters to rows still in draft state at aggregation time.
 *
 * Re-aggregation drops the draft count for buckets whose drafts have since
 * been submitted (the row no longer matches `submitted_at IS NULL`). The
 * trailing 3-bucket window catches the common case; drafts that linger > 3
 * days before being submitted leave a stale draft_count on their creation day
 * until a manual backfill.
 *
 * Soft-deleted responses are excluded so a `delete` action on the response
 * reduces both counters once re-aggregation catches up.
 */
async function aggregateQuestionnaireResponses(
  client: postgres.Sql,
  grain: Grain,
  range: BucketRange,
  projectId: string | null,
): Promise<{ perAppRows: number; rollupRows: number }> {
  const table =
    grain === "day" ? "questionnaire_responses_daily" : "questionnaire_responses_hourly";
  const bucketCol = grain === "day" ? "day" : "hour";
  const bucketCast = grain === "day" ? "::date" : "";
  const startIso = range.start.toISOString();
  const endIso = range.endExclusive.toISOString();

  return client.begin(async (sql) => {
    await sql.unsafe(
      `DELETE FROM ${table}
       WHERE ${bucketCol} >= $1${bucketCast} AND ${bucketCol} < $2${bucketCast}
         AND ($3::uuid IS NULL OR project_id = $3)`,
      [startIso, endIso, projectId],
    );

    // Two-axis aggregation: a response can transition draft → submitted across
    // buckets. The UNION ALL emits a row in each bucket the response touches —
    // a draft-bucket row keyed on created_at while submitted_at IS NULL, and a
    // submitted-bucket row keyed on submitted_at once it flips. Re-aggregation
    // after a draft becomes a submission re-evaluates from current state, so
    // the old draft-bucket row drops to 0 (no row in the UNION matches that
    // bucket anymore) and the new submitted-bucket row appears.
    const perApp = await sql.unsafe(
      `WITH submissions AS (
         SELECT
           r.app_id,
           r.project_id,
           r.questionnaire_id,
           r.is_dev,
           date_trunc('${grain}', r.submitted_at) AS bucket,
           1 AS submitted_inc,
           0 AS draft_inc
         FROM questionnaire_responses r
         WHERE r.submitted_at IS NOT NULL
           AND r.deleted_at IS NULL
           AND r.submitted_at >= $1 AND r.submitted_at < $2
       ),
       drafts AS (
         SELECT
           r.app_id,
           r.project_id,
           r.questionnaire_id,
           r.is_dev,
           date_trunc('${grain}', r.created_at) AS bucket,
           0 AS submitted_inc,
           1 AS draft_inc
         FROM questionnaire_responses r
         WHERE r.submitted_at IS NULL
           AND r.deleted_at IS NULL
           AND r.created_at >= $1 AND r.created_at < $2
       ),
       combined AS (
         SELECT * FROM submissions
         UNION ALL
         SELECT * FROM drafts
       )
       INSERT INTO ${table} (team_id, project_id, app_id, questionnaire_id, is_dev, ${bucketCol}, submitted_count, draft_count)
       SELECT
         a.team_id,
         c.project_id,
         c.app_id,
         c.questionnaire_id,
         c.is_dev,
         c.bucket${bucketCast},
         SUM(c.submitted_inc)::int,
         SUM(c.draft_inc)::int
       FROM combined c
       JOIN apps a ON a.id = c.app_id AND a.deleted_at IS NULL
       WHERE ($3::uuid IS NULL OR c.project_id = $3)
       GROUP BY a.team_id, c.project_id, c.app_id, c.questionnaire_id, c.is_dev, c.bucket`,
      [startIso, endIso, projectId],
    );

    const rollup = await sql.unsafe(
      `WITH submissions AS (
         SELECT
           r.project_id,
           r.questionnaire_id,
           r.is_dev,
           date_trunc('${grain}', r.submitted_at) AS bucket,
           1 AS submitted_inc,
           0 AS draft_inc
         FROM questionnaire_responses r
         WHERE r.submitted_at IS NOT NULL
           AND r.deleted_at IS NULL
           AND r.submitted_at >= $1 AND r.submitted_at < $2
       ),
       drafts AS (
         SELECT
           r.project_id,
           r.questionnaire_id,
           r.is_dev,
           date_trunc('${grain}', r.created_at) AS bucket,
           0 AS submitted_inc,
           1 AS draft_inc
         FROM questionnaire_responses r
         WHERE r.submitted_at IS NULL
           AND r.deleted_at IS NULL
           AND r.created_at >= $1 AND r.created_at < $2
       ),
       combined AS (
         SELECT * FROM submissions
         UNION ALL
         SELECT * FROM drafts
       )
       INSERT INTO ${table} (team_id, project_id, app_id, questionnaire_id, is_dev, ${bucketCol}, submitted_count, draft_count)
       SELECT
         p.team_id,
         c.project_id,
         NULL,
         c.questionnaire_id,
         c.is_dev,
         c.bucket${bucketCast},
         SUM(c.submitted_inc)::int,
         SUM(c.draft_inc)::int
       FROM combined c
       JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL
       WHERE ($3::uuid IS NULL OR c.project_id = $3)
       GROUP BY p.team_id, c.project_id, c.questionnaire_id, c.is_dev, c.bucket`,
      [startIso, endIso, projectId],
    );

    return { perAppRows: perApp.count ?? 0, rollupRows: rollup.count ?? 0 };
  }) as Promise<{ perAppRows: number; rollupRows: number }>;
}

function buildHandler(grain: Grain): JobHandler {
  return async (ctx, params) => {
    const range = resolveRange(grain, params);
    const projectId = typeof params.project_id === "string" ? params.project_id : null;
    const totalBuckets = bucketCount(grain, range);

    const client = ctx.createClient();
    const stats = {
      events_per_app_rows: 0,
      events_rollup_rows: 0,
      metric_events_per_app_rows: 0,
      metric_events_rollup_rows: 0,
      funnel_events_per_app_rows: 0,
      funnel_events_rollup_rows: 0,
      questionnaire_per_app_rows: 0,
      questionnaire_rollup_rows: 0,
    };

    try {
      // Each per-kind aggregator handles the whole range in a single SQL pair
      // (per-app + rollup). For 365-day backfills that's 8 SQL statements
      // total, not 365×4×2 = 2,920.
      await ctx.updateProgress({ processed: 0, total: 4, message: "events" });
      let r = await aggregateEvents(client, grain, range, projectId);
      stats.events_per_app_rows = r.perAppRows;
      stats.events_rollup_rows = r.rollupRows;
      if (ctx.isCancelled()) return { ...stats, cancelled: true };

      await ctx.updateProgress({ processed: 1, total: 4, message: "metric_events" });
      r = await aggregateMetricEvents(client, grain, range, projectId);
      stats.metric_events_per_app_rows = r.perAppRows;
      stats.metric_events_rollup_rows = r.rollupRows;
      if (ctx.isCancelled()) return { ...stats, cancelled: true };

      await ctx.updateProgress({ processed: 2, total: 4, message: "funnel_events" });
      r = await aggregateFunnelEvents(client, grain, range, projectId);
      stats.funnel_events_per_app_rows = r.perAppRows;
      stats.funnel_events_rollup_rows = r.rollupRows;
      if (ctx.isCancelled()) return { ...stats, cancelled: true };

      await ctx.updateProgress({ processed: 3, total: 4, message: "questionnaire_responses" });
      r = await aggregateQuestionnaireResponses(client, grain, range, projectId);
      stats.questionnaire_per_app_rows = r.perAppRows;
      stats.questionnaire_rollup_rows = r.rollupRows;

      await ctx.updateProgress({ processed: 4, total: 4, message: "done" });
    } finally {
      await client.end();
    }

    return {
      grain,
      project_id: projectId,
      range_start: range.start.toISOString(),
      range_end_exclusive: range.endExclusive.toISOString(),
      buckets: totalBuckets,
      ...stats,
    };
  };
}

export const statsAggregateDailyHandler: JobHandler = buildHandler("day");
export const statsAggregateHourlyHandler: JobHandler = buildHandler("hour");
