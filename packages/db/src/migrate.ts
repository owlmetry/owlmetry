import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { ensurePartitions, ensureMetricEventPartitions } from "./partitions.js";
import "dotenv/config";

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

async function main() {
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  // Remove 'tracking' from log_level enum if present (pre-production cleanup)
  await removeTrackingFromLogLevelEnum(client);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });

  // Convert Drizzle's regular tables to partitioned
  await convertEventsTableToPartitioned(client);
  await convertMetricEventsTableToPartitioned(client);

  // Create partitions for current month + next 2 months
  await ensurePartitions(client, 3);
  await ensureMetricEventPartitions(client, 3);

  await client.end();
  console.log("Migrations complete.");
}

async function removeTrackingFromLogLevelEnum(client: postgres.Sql) {
  const enumCheck = await client`
    SELECT 1 FROM pg_enum WHERE enumlabel = 'tracking'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'log_level')
  `;
  if (enumCheck.length === 0) return;

  console.log("Removing 'tracking' from log_level enum...");
  // Update any existing rows that use 'tracking' to 'info'
  try {
    await client.unsafe(`UPDATE events SET level = 'info' WHERE level = 'tracking'`);
  } catch {
    // events table may not exist yet
  }

  // Recreate the enum without 'tracking'
  await client.unsafe(`ALTER TYPE log_level RENAME TO log_level_old`);
  await client.unsafe(`CREATE TYPE log_level AS ENUM ('info', 'debug', 'warn', 'error', 'attention')`);
  try {
    await client.unsafe(`ALTER TABLE events ALTER COLUMN level TYPE log_level USING level::text::log_level`);
  } catch {
    // events table may not exist yet
  }
  await client.unsafe(`DROP TYPE log_level_old`);
}

async function convertEventsTableToPartitioned(client: postgres.Sql) {
  const result = await client`
    SELECT relkind FROM pg_class WHERE relname = 'events'
  `;

  if (result.length > 0 && result[0].relkind === "p") {
    // Already partitioned
    return;
  }

  if (result.length > 0) {
    console.log("Converting events table to partitioned...");
    await client`DROP TABLE IF EXISTS events CASCADE`;
  }

  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS events (
      id UUID DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL,
      client_event_id VARCHAR(255),
      session_id UUID NOT NULL,
      user_id VARCHAR(255),
      level log_level NOT NULL,
      source_module TEXT,
      message TEXT NOT NULL,
      screen_name VARCHAR(255),
      custom_attributes JSONB,
      environment environment,
      os_version VARCHAR(50),
      app_version VARCHAR(50),
      device_model VARCHAR(100),
      build_number VARCHAR(50),
      locale VARCHAR(20),
      is_debug BOOLEAN NOT NULL DEFAULT FALSE,
      "timestamp" TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ) PARTITION BY RANGE ("timestamp");
  `);
}

async function convertMetricEventsTableToPartitioned(client: postgres.Sql) {
  const result = await client`
    SELECT relkind FROM pg_class WHERE relname = 'metric_events'
  `;

  if (result.length > 0 && result[0].relkind === "p") {
    // Already partitioned
    return;
  }

  if (result.length > 0) {
    console.log("Converting metric_events table to partitioned...");
    await client`DROP TABLE IF EXISTS metric_events CASCADE`;
  }

  // Ensure enums exist before creating table
  const metricPhaseCheck = await client`
    SELECT 1 FROM pg_type WHERE typname = 'metric_phase'
  `;
  if (metricPhaseCheck.length === 0) {
    await client.unsafe(`CREATE TYPE metric_phase AS ENUM ('start', 'complete', 'fail', 'cancel', 'record')`);
  }

  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS metric_events (
      id UUID DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL,
      session_id UUID NOT NULL,
      user_id VARCHAR(255),
      metric_slug VARCHAR(255) NOT NULL,
      phase metric_phase NOT NULL,
      tracking_id UUID,
      duration_ms INTEGER,
      error TEXT,
      attributes JSONB,
      environment environment,
      os_version VARCHAR(50),
      app_version VARCHAR(50),
      device_model VARCHAR(100),
      build_number VARCHAR(50),
      is_debug BOOLEAN NOT NULL DEFAULT FALSE,
      client_event_id UUID,
      "timestamp" TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ) PARTITION BY RANGE ("timestamp");
  `);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
