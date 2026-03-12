import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import "dotenv/config";

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

async function main() {
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });

  // Create partitioned events table and initial partitions
  await setupPartitions(client);

  await client.end();
  console.log("Migrations complete.");
}

async function setupPartitions(client: postgres.Sql) {
  // Check if events table already exists and is partitioned
  const result = await client`
    SELECT relkind FROM pg_class WHERE relname = 'events'
  `;

  if (result.length > 0 && result[0].relkind === "p") {
    console.log("Events table already partitioned, creating upcoming partitions...");
  } else if (result.length > 0) {
    // Table exists but is not partitioned — drop and recreate
    console.log("Converting events table to partitioned...");
    await client`DROP TABLE IF EXISTS events CASCADE`;
    await createPartitionedEventsTable(client);
  } else {
    // Table doesn't exist yet (first run)
    await createPartitionedEventsTable(client);
  }

  // Create partitions for current month and next 2 months
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    await createMonthPartition(client, date);
  }
}

async function createPartitionedEventsTable(client: postgres.Sql) {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS events (
      id UUID DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL,
      client_event_id VARCHAR(255),
      user_identifier VARCHAR(255),
      level log_level NOT NULL,
      source TEXT,
      body TEXT NOT NULL,
      context VARCHAR(255),
      meta JSONB,
      platform VARCHAR(20),
      os_version VARCHAR(50),
      app_version VARCHAR(50),
      device_model VARCHAR(100),
      build_number VARCHAR(50),
      locale VARCHAR(20),
      "timestamp" TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      solved BOOLEAN NOT NULL DEFAULT false
    ) PARTITION BY RANGE ("timestamp");
  `);
}

async function createMonthPartition(client: postgres.Sql, date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const partitionName = `events_${year}_${month}`;

  const nextMonth = new Date(year, date.getMonth() + 1, 1);
  const nextYear = nextMonth.getFullYear();
  const nextMo = String(nextMonth.getMonth() + 1).padStart(2, "0");

  const from = `${year}-${month}-01`;
  const to = `${nextYear}-${nextMo}-01`;

  try {
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS ${partitionName}
        PARTITION OF events
        FOR VALUES FROM ('${from}') TO ('${to}');
    `);

    // Create indexes on this partition
    await client.unsafe(`
      CREATE INDEX IF NOT EXISTS ${partitionName}_app_ts_idx
        ON ${partitionName} (app_id, "timestamp");
      CREATE INDEX IF NOT EXISTS ${partitionName}_app_level_ts_idx
        ON ${partitionName} (app_id, level, "timestamp");
      CREATE INDEX IF NOT EXISTS ${partitionName}_app_user_ts_idx
        ON ${partitionName} (app_id, user_identifier, "timestamp");
      CREATE INDEX IF NOT EXISTS ${partitionName}_app_ctx_ts_idx
        ON ${partitionName} (app_id, context, "timestamp");
      CREATE INDEX IF NOT EXISTS ${partitionName}_client_eid_idx
        ON ${partitionName} (app_id, client_event_id);
    `);

    console.log(`Partition ${partitionName} ready.`);
  } catch (err: any) {
    if (err.code === "42P07") {
      // relation already exists — fine
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
