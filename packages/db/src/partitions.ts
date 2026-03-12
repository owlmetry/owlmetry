import type postgres from "postgres";

export async function ensurePartitions(client: postgres.Sql, monthsAhead = 3) {
  // Check if events table exists and is partitioned
  const result = await client`
    SELECT relkind FROM pg_class WHERE relname = 'events'
  `;

  if (result.length === 0 || result[0].relkind !== "p") {
    // Table doesn't exist or isn't partitioned — skip (migration handles initial setup)
    return;
  }

  const now = new Date();
  for (let i = 0; i < monthsAhead; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    await createMonthPartition(client, date);
  }
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
