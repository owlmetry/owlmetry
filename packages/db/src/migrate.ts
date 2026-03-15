import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { ensurePartitions } from "./partitions.js";
import "dotenv/config";

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

async function main() {
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });

  // Convert Drizzle's regular events table to partitioned
  await convertEventsTableToPartitioned(client);

  // Create partitions for current month + next 2 months
  await ensurePartitions(client, 3);

  await client.end();
  console.log("Migrations complete.");
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

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
