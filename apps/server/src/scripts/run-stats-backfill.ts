/**
 * Standalone runner for the stats aggregation handlers. Used by the top-level
 * `pnpm backfill` script so the operator doesn't have to spin up the full
 * server / pg-boss machinery for a one-off rollup refresh.
 *
 * Lives inside apps/server so transitive deps (postgres, drizzle, the handlers
 * themselves) resolve cleanly without each script having to declare them.
 *
 * Idempotent: the underlying handlers use DELETE-then-INSERT inside a single
 * transaction per bucket range, so re-running over the same window replaces
 * the existing rollup rows in place.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "@owlmetry/db";
import { statsAggregateDailyHandler, statsAggregateHourlyHandler } from "../jobs/stats-aggregate.js";
import type { JobContext } from "../services/job-runner.js";

export interface BackfillOptions {
  databaseUrl: string;
  windowDays?: number;
  onProgress?: (kind: "daily" | "hourly", message: string, processed: number, total: number) => void;
}

export interface BackfillResult {
  daily: Record<string, unknown>;
  hourly: Record<string, unknown>;
}

export async function runStatsBackfill(opts: BackfillOptions): Promise<BackfillResult> {
  const windowDays = opts.windowDays ?? 365;
  const sql = postgres(opts.databaseUrl, { max: 4 });
  const db = drizzle(sql, { schema });

  try {
    const now = new Date();
    const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const windowStart = new Date(yesterday);
    windowStart.setUTCDate(windowStart.getUTCDate() - (windowDays - 1));

    const dailyParams = {
      start: windowStart.toISOString().slice(0, 10),
      end: yesterday.toISOString().slice(0, 10),
    };
    const hourlyParams = {
      start: windowStart.toISOString().slice(0, 13) + ":00",
      end: yesterday.toISOString().slice(0, 13) + ":00",
    };

    const makeCtx = (kind: "daily" | "hourly"): JobContext => ({
      runId: `backfill-${kind}`,
      updateProgress: async (progress) => {
        opts.onProgress?.(kind, progress.message ?? "working", progress.processed, progress.total);
      },
      isCancelled: () => false,
      log: {
        info: () => {},
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
      },
      db,
      createClient: () => postgres(opts.databaseUrl, { max: 1 }),
    });

    const daily = await statsAggregateDailyHandler(makeCtx("daily"), dailyParams);
    const hourly = await statsAggregateHourlyHandler(makeCtx("hourly"), hourlyParams);

    return { daily, hourly };
  } finally {
    await sql.end();
  }
}
