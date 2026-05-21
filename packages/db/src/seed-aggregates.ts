/**
 * Seed fake daily + hourly aggregation rollups for every project in the local
 * dev database. Use this to verify the dashboard sparkline UI without waiting
 * for real events to accumulate or running the production aggregator.
 *
 * Each project gets:
 *   - 365 days of `events_daily` rollup rows (one per project, app_id NULL,
 *     is_dev=false) so 7/14/30/60/90-day sparklines all render with depth.
 *   - 72 hours of `events_hourly` rollup rows for any future hourly views.
 *   - Daily rollups for every metric_definition (phase=complete) and funnel
 *     terminal step in the project, plus questionnaire submissions for every
 *     questionnaire — enough to populate every dashboard card.
 *
 * Numbers follow a noisy random walk so the line has a believable shape
 * (mostly small movements, occasional bigger jumps). All rows are
 * is_dev=false so the default production data_mode picks them up. Values are
 * anonymous — only counts, no user IDs — so this is safe to run repeatedly.
 *
 * Idempotency: ON CONFLICT DO UPDATE on the rollup row keys, so re-running
 * just replaces existing rows with new fake values.
 */
import { createDatabaseConnection } from "./index.js";
import {
  projects,
  apps,
  funnelDefinitions,
  metricDefinitions,
  questionnaires,
} from "./schema.js";
import { eq, and, isNull } from "drizzle-orm";
import postgres from "postgres";
import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  console.error("seed-aggregates is for development only. Aborting.");
  process.exit(1);
}

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

const DAYS = 365;
const HOURS = 72;

/**
 * Believable-looking time series: long-period sin wave for slow growth/decline,
 * a weekly cycle (lower weekend traffic), Gaussian-ish day-to-day noise, and a
 * small chance of a spike day. Reverts toward `mean` so a 365-day series stays
 * grounded around the requested magnitude instead of wandering off like a pure
 * random walk does. `n` is the number of points; index 0 is the oldest day.
 */
function plausibleSeries(n: number, mean: number, amplitude: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // Long sin wave (period ~120 days) for slow trend changes.
    const trend = Math.sin((i / 120) * Math.PI * 2) * amplitude * 0.4;
    // Weekly cycle (period 7 days) — Mon-Fri ~10% higher than weekends.
    const weekly = Math.sin((i / 7) * Math.PI * 2) * amplitude * 0.15;
    // Gaussian-ish jitter (sum of two uniforms ≈ triangular distribution).
    const noise = ((Math.random() + Math.random()) - 1) * amplitude * 0.3;
    // 4% chance of a spike day (a marketing push, a viral share).
    const spike = Math.random() < 0.04 ? amplitude * (0.8 + Math.random() * 0.6) : 0;
    out.push(Math.max(0, Math.round(mean + trend + weekly + noise + spike)));
  }
  return out;
}

function utcDay(daysAgo: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  return d.toISOString().slice(0, 10);
}

function utcHour(hoursAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() - hoursAgo,
  ));
}

async function main() {
  const db = createDatabaseConnection(url);
  const sql = postgres(url, { max: 1 });

  console.log("Seeding fake aggregation rollups...");

  const projectRows = await db
    .select({ id: projects.id, team_id: projects.team_id, name: projects.name })
    .from(projects)
    .where(isNull(projects.deleted_at));

  if (projectRows.length === 0) {
    console.log("  no projects found — run `pnpm dev:seed` first");
    process.exit(0);
  }

  for (const project of projectRows) {
    console.log(`  ${project.name} (${project.id.slice(0, 8)}…)`);

    // ── events_daily / events_hourly (project rollup rows) ──────────────
    const dailyEvents = plausibleSeries(DAYS, 800, 80);
    const dailyUsers = plausibleSeries(DAYS, 250, 30);
    const dailySessions = plausibleSeries(DAYS, 400, 50);
    const dailyErrors = plausibleSeries(DAYS, 15, 5);

    for (let i = 0; i < DAYS; i++) {
      // i=0 is the oldest day, i=DAYS-1 is yesterday.
      const day = utcDay(DAYS - i);
      await sql`
        INSERT INTO events_daily (team_id, project_id, app_id, is_dev, day, event_count, unique_users, unique_sessions, error_count)
        VALUES (${project.team_id}, ${project.id}, NULL, false, ${day}, ${dailyEvents[i]}, ${dailyUsers[i]}, ${dailySessions[i]}, ${dailyErrors[i]})
        ON CONFLICT (project_id, is_dev, day) WHERE app_id IS NULL
        DO UPDATE SET
          event_count = EXCLUDED.event_count,
          unique_users = EXCLUDED.unique_users,
          unique_sessions = EXCLUDED.unique_sessions,
          error_count = EXCLUDED.error_count,
          updated_at = now()
      `;
    }

    const hourlyEvents = plausibleSeries(HOURS, 35, 10);
    const hourlyUsers = plausibleSeries(HOURS, 12, 4);
    const hourlySessions = plausibleSeries(HOURS, 18, 6);
    for (let i = 0; i < HOURS; i++) {
      const hour = utcHour(HOURS - i);
      await sql`
        INSERT INTO events_hourly (team_id, project_id, app_id, is_dev, hour, event_count, unique_users, unique_sessions, error_count)
        VALUES (${project.team_id}, ${project.id}, NULL, false, ${hour}, ${hourlyEvents[i]}, ${hourlyUsers[i]}, ${hourlySessions[i]}, 0)
        ON CONFLICT (project_id, is_dev, hour) WHERE app_id IS NULL
        DO UPDATE SET
          event_count = EXCLUDED.event_count,
          unique_users = EXCLUDED.unique_users,
          unique_sessions = EXCLUDED.unique_sessions,
          updated_at = now()
      `;
    }

    // ── metric_events_daily — one row per (metric_slug, phase=complete) per day ──
    const metrics = await db
      .select({ slug: metricDefinitions.slug })
      .from(metricDefinitions)
      .where(and(eq(metricDefinitions.project_id, project.id), isNull(metricDefinitions.deleted_at)));
    for (const m of metrics) {
      const series = plausibleSeries(DAYS, 60, 15);
      for (let i = 0; i < DAYS; i++) {
        const day = utcDay(DAYS - i);
        await sql`
          INSERT INTO metric_events_daily (team_id, project_id, app_id, is_dev, day, metric_slug, phase, count, sum_duration_ms)
          VALUES (${project.team_id}, ${project.id}, NULL, false, ${day}, ${m.slug}, 'complete', ${series[i]}, ${series[i] * 250})
          ON CONFLICT (project_id, is_dev, day, metric_slug, phase) WHERE app_id IS NULL
          DO UPDATE SET count = EXCLUDED.count, sum_duration_ms = EXCLUDED.sum_duration_ms, updated_at = now()
        `;
      }
    }

    // ── funnel_events_daily — one row per terminal step per day ─────────
    const funnels = await db
      .select({ steps: funnelDefinitions.steps })
      .from(funnelDefinitions)
      .where(and(eq(funnelDefinitions.project_id, project.id), isNull(funnelDefinitions.deleted_at)));
    const terminalSteps = new Set<string>();
    for (const f of funnels) {
      const steps = (f.steps as Array<{ name: string }> | null) ?? [];
      if (steps.length > 0) terminalSteps.add(steps[steps.length - 1].name);
    }
    for (const step of terminalSteps) {
      const series = plausibleSeries(DAYS, 40, 12);
      const uniqueUsers = plausibleSeries(DAYS, 25, 8);
      for (let i = 0; i < DAYS; i++) {
        const day = utcDay(DAYS - i);
        await sql`
          INSERT INTO funnel_events_daily (team_id, project_id, app_id, is_dev, day, step_name, count, unique_users)
          VALUES (${project.team_id}, ${project.id}, NULL, false, ${day}, ${step}, ${series[i]}, ${uniqueUsers[i]})
          ON CONFLICT (project_id, is_dev, day, step_name) WHERE app_id IS NULL
          DO UPDATE SET count = EXCLUDED.count, unique_users = EXCLUDED.unique_users, updated_at = now()
        `;
      }
    }

    // ── questionnaire_responses_daily — one row per questionnaire per day ─
    const qs = await db
      .select({ id: questionnaires.id })
      .from(questionnaires)
      .where(and(eq(questionnaires.project_id, project.id), isNull(questionnaires.deleted_at)));
    for (const q of qs) {
      const submitted = plausibleSeries(DAYS, 8, 3);
      const drafts = plausibleSeries(DAYS, 3, 2);
      for (let i = 0; i < DAYS; i++) {
        const day = utcDay(DAYS - i);
        await sql`
          INSERT INTO questionnaire_responses_daily (team_id, project_id, app_id, questionnaire_id, is_dev, day, submitted_count, draft_count)
          VALUES (${project.team_id}, ${project.id}, NULL, ${q.id}, false, ${day}, ${submitted[i]}, ${drafts[i]})
          ON CONFLICT (project_id, is_dev, day, questionnaire_id) WHERE app_id IS NULL
          DO UPDATE SET submitted_count = EXCLUDED.submitted_count, draft_count = EXCLUDED.draft_count, updated_at = now()
        `;
      }
    }
  }

  await sql.end();
  console.log("done — refresh /dashboard to see sparklines.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
