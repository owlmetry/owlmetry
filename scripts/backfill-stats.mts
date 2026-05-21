/**
 * Backfill the stats rollup tables (daily + hourly) for the trailing 365 days.
 *
 * Idempotent: the underlying aggregators run DELETE-then-INSERT in a single
 * transaction per bucket range, so re-running this over the same window just
 * replaces the existing rollup rows. Safe to run as often as needed.
 *
 * Designed to run on the production VPS where `.env` already provides
 * DATABASE_URL — same convention as `pnpm prod:jobs`. Locally, point
 * DATABASE_URL at the dev database and you get a dev-side backfill.
 *
 * Usage:
 *   pnpm backfill
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runStatsBackfill } from "../apps/server/src/scripts/run-stats-backfill.js";

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
    const line = readFileSync(envPath, "utf-8")
      .split("\n")
      .find((l) => l.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
  } catch {
    // .env not present — fall through.
  }
  console.error("DATABASE_URL must be set (export it or add it to .env).");
  process.exit(1);
}

const databaseUrl = loadDatabaseUrl();

console.log("Backfilling stats rollups (last 365 days)...");
const started = Date.now();

try {
  const result = await runStatsBackfill({
    databaseUrl,
    onProgress: (kind, message, processed, total) => {
      process.stdout.write(`\r  ${kind.padEnd(6)}  ${message.padEnd(28)}  ${processed}/${total}    `);
    },
  });
  process.stdout.write("\n");
  console.log(`Daily : ${JSON.stringify(result.daily)}`);
  console.log(`Hourly: ${JSON.stringify(result.hourly)}`);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s.`);
  process.exit(0);
} catch (err) {
  console.error("\nBackfill failed:", err);
  process.exit(1);
}
