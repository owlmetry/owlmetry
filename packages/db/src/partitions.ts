import type postgres from "postgres";

const PARTITION_NAME_PATTERN = /^events_\d{4}_\d{2}$/;

export async function getDatabaseSizeBytes(client: postgres.Sql): Promise<number> {
  const result = await client`SELECT pg_database_size(current_database()) AS size`;
  return Number(result[0].size);
}

export async function getEventPartitionNames(client: postgres.Sql): Promise<string[]> {
  const rows = await client`
    SELECT c.relname AS partition_name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'events'
    ORDER BY c.relname ASC
  `;
  return rows.map((r) => r.partition_name as string);
}

export async function dropOldestEventPartitions(
  client: postgres.Sql,
  maxSizeBytes: number
): Promise<{ droppedPartitions: string[]; deletedRows: number; currentSizeBytes: number }> {
  const droppedPartitions: string[] = [];
  let deletedRows = 0;

  let currentSize = await getDatabaseSizeBytes(client);
  if (currentSize <= maxSizeBytes) {
    return { droppedPartitions, deletedRows, currentSizeBytes: currentSize };
  }

  const partitions = await getEventPartitionNames(client);

  const now = new Date();
  const currentPartitionName = `events_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Phase 1: Drop entire old partitions
  for (const name of partitions) {
    if (currentSize <= maxSizeBytes) break;

    // Never drop current or future partitions
    if (name >= currentPartitionName) continue;

    if (!PARTITION_NAME_PATTERN.test(name)) continue;

    await client.unsafe(`DROP TABLE ${name}`);
    droppedPartitions.push(name);

    currentSize = await getDatabaseSizeBytes(client);
  }

  // Phase 2: Row-level fallback — delete oldest rows from the current partition.
  // pg_database_size won't reflect DELETEs until VACUUM, so we track by row count
  // and delete a fixed number of batches to free up space for autovacuum to reclaim.
  if (currentSize > maxSizeBytes) {
    const batchSize = 1000;
    const maxIterations = 100;

    // Find the oldest remaining partition to target directly (ctid is partition-local)
    const remaining = await getEventPartitionNames(client);
    const targetPartition = remaining.find((n) => PARTITION_NAME_PATTERN.test(n));

    if (targetPartition) {
      for (let i = 0; i < maxIterations; i++) {
        const deleted = await client.unsafe(`
          DELETE FROM ${targetPartition}
          WHERE ctid IN (
            SELECT ctid FROM ${targetPartition}
            ORDER BY "timestamp" ASC
            LIMIT ${batchSize}
          )
        `);

        const count = Number(deleted.count ?? 0);
        if (count === 0) break;

        deletedRows += count;
      }
    }
  }

  currentSize = await getDatabaseSizeBytes(client);
  return { droppedPartitions, deletedRows, currentSizeBytes: currentSize };
}

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
    await createMonthlyEventPartition(client, date);
  }
}

async function createMonthlyEventPartition(client: postgres.Sql, date: Date) {
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
        ON ${partitionName} (app_id, user_id, "timestamp");
      CREATE INDEX IF NOT EXISTS ${partitionName}_app_screen_name_ts_idx
        ON ${partitionName} (app_id, screen_name, "timestamp");
      CREATE INDEX IF NOT EXISTS ${partitionName}_client_eid_idx
        ON ${partitionName} (app_id, client_event_id);
      CREATE INDEX IF NOT EXISTS ${partitionName}_app_session_ts_idx
        ON ${partitionName} (app_id, session_id, "timestamp");
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
