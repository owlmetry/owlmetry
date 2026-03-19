import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { ensurePartitions, ensureMetricEventPartitions } from "./partitions.js";
import "dotenv/config";

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

async function main() {
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  // Remove stale log_level enum values (pre-production cleanup)
  await removeStaleLogLevelEnumValues(client);

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

async function removeStaleLogLevelEnumValues(client: postgres.Sql) {
  const staleCheck = await client`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'log_level')
      AND enumlabel IN ('tracking', 'attention')
  `;
  if (staleCheck.length === 0) return;

  const staleValues = staleCheck.map((r) => r.enumlabel as string);
  console.log(`Removing ${staleValues.map((v) => `'${v}'`).join(', ')} from log_level enum...`);

  for (const val of staleValues) {
    try {
      await client.unsafe(`UPDATE events SET level = 'info' WHERE level = '${val}'`);
    } catch {
      // events table may not exist yet
    }
  }

  await client.unsafe(`ALTER TYPE log_level RENAME TO log_level_old`);
  await client.unsafe(`CREATE TYPE log_level AS ENUM ('info', 'debug', 'warn', 'error')`);
  try {
    await client.unsafe(`ALTER TABLE events ALTER COLUMN level TYPE log_level USING level::text::log_level`);
  } catch {
    // events table may not exist yet
  }
  await client.unsafe(`DROP TYPE log_level_old`);
}

/**
 * Generic helper: check if a table exists and is partitioned.
 * If it exists but isn't partitioned, drop and recreate with the given DDL.
 * Calls `preCreateHook` before creating (e.g. to ensure enums exist).
 */
async function convertTableToPartitioned(
  client: postgres.Sql,
  tableName: string,
  createDDL: string,
  preCreateHook?: (client: postgres.Sql) => Promise<void>,
) {
  const result = await client`
    SELECT relkind FROM pg_class WHERE relname = ${tableName}
  `;

  if (result.length > 0 && result[0].relkind === "p") {
    return;
  }

  if (result.length > 0) {
    console.log(`Converting ${tableName} table to partitioned...`);
    await client.unsafe(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
  }

  if (preCreateHook) {
    await preCreateHook(client);
  }

  await client.unsafe(createDDL);
}

async function convertEventsTableToPartitioned(client: postgres.Sql) {
  await convertTableToPartitioned(client, "events", `
    CREATE TABLE IF NOT EXISTS events (
      id UUID DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL,
      client_event_id UUID,
      session_id UUID NOT NULL,
      user_id VARCHAR(255),
      api_key_id UUID,
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
  await convertTableToPartitioned(
    client,
    "metric_events",
    `
    CREATE TABLE IF NOT EXISTS metric_events (
      id UUID DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL,
      session_id UUID NOT NULL,
      user_id VARCHAR(255),
      api_key_id UUID,
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
    `,
    async (c) => {
      const check = await c`SELECT 1 FROM pg_type WHERE typname = 'metric_phase'`;
      if (check.length === 0) {
        await c.unsafe(`CREATE TYPE metric_phase AS ENUM ('start', 'complete', 'fail', 'cancel', 'record')`);
      }
    },
  );
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
