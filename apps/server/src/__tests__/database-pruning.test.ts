import { describe, it, expect, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import {
  getDatabaseSizeBytes,
  dropOldestEventPartitions,
  ensurePartitions,
} from "@owlmetry/db";

const TEST_DB_URL = "postgres://localhost:5432/owlmetry_test";
let client: postgres.Sql;

beforeEach(async () => {
  client = postgres(TEST_DB_URL, { max: 1 });

  // Drop all event partitions to start clean
  const partitions = await client`
    SELECT c.relname AS partition_name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'events'
    ORDER BY c.relname ASC
  `;
  for (const row of partitions) {
    await client.unsafe(`DROP TABLE ${row.partition_name}`);
  }
});

afterAll(async () => {
  // Restore current-month partition for other tests
  const restore = postgres(TEST_DB_URL, { max: 1 });
  await ensurePartitions(restore, 1);
  await restore.end();
});

async function createTestPartition(sql: postgres.Sql, year: number, month: number) {
  const mo = String(month).padStart(2, "0");
  const name = `events_${year}_${mo}`;
  const nextDate = new Date(year, month, 1); // month is 1-based here but Date uses 0-based — works because we pass month directly
  const nextYear = nextDate.getFullYear();
  const nextMo = String(nextDate.getMonth() + 1).padStart(2, "0");

  const from = `${year}-${mo}-01`;
  const to = `${nextYear}-${nextMo}-01`;

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${name}
      PARTITION OF events
      FOR VALUES FROM ('${from}') TO ('${to}')
  `);

  return name;
}

async function insertTestEvent(sql: postgres.Sql, timestamp: string) {
  await sql.unsafe(`
    INSERT INTO events (app_id, level, message, "timestamp")
    VALUES ('00000000-0000-0000-0000-000000000001', 'info', 'test', '${timestamp}')
  `);
}

async function getPartitionNames(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql`
    SELECT c.relname AS partition_name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'events'
    ORDER BY c.relname ASC
  `;
  return rows.map((r) => r.partition_name as string);
}

describe("getDatabaseSizeBytes", () => {
  it("returns a positive number", async () => {
    const size = await getDatabaseSizeBytes(client);
    expect(size).toBeGreaterThan(0);
    await client.end();
  });
});

describe("dropOldestEventPartitions", () => {
  it("does nothing when under the size limit", async () => {
    const now = new Date();
    await createTestPartition(client, now.getFullYear(), now.getMonth() + 1);

    // Use a huge limit so nothing gets pruned
    const result = await dropOldestEventPartitions(client, Number.MAX_SAFE_INTEGER);

    expect(result.droppedPartitions).toEqual([]);
    expect(result.deletedRows).toBe(0);
    expect(result.currentSizeBytes).toBeGreaterThan(0);
    await client.end();
  });

  it("drops oldest partitions first when over the limit", async () => {
    // Create old partitions and the current month
    await createTestPartition(client, 2024, 1);
    await createTestPartition(client, 2024, 2);
    await createTestPartition(client, 2024, 3);
    const now = new Date();
    await createTestPartition(client, now.getFullYear(), now.getMonth() + 1);

    // Insert data into old partitions
    await insertTestEvent(client, "2024-01-15T00:00:00Z");
    await insertTestEvent(client, "2024-02-15T00:00:00Z");
    await insertTestEvent(client, "2024-03-15T00:00:00Z");

    // Use 1-byte limit to force pruning
    const result = await dropOldestEventPartitions(client, 1);

    // Should have dropped the old partitions
    expect(result.droppedPartitions).toContain("events_2024_01");
    expect(result.droppedPartitions).toContain("events_2024_02");
    expect(result.droppedPartitions).toContain("events_2024_03");

    // Current-month partition should survive
    const remaining = await getPartitionNames(client);
    const currentPartitionName = `events_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
    expect(remaining).toContain(currentPartitionName);

    await client.end();
  });

  it("never drops current-month partition", async () => {
    const now = new Date();
    await createTestPartition(client, now.getFullYear(), now.getMonth() + 1);

    // 1-byte limit but only current month exists — should not drop it
    const result = await dropOldestEventPartitions(client, 1);

    expect(result.droppedPartitions).toEqual([]);

    const remaining = await getPartitionNames(client);
    expect(remaining.length).toBe(1);

    await client.end();
  });

  it("falls back to row deletion when only current partition remains", async () => {
    const now = new Date();
    await createTestPartition(client, now.getFullYear(), now.getMonth() + 1);

    // Insert some rows into current month
    const ts = now.toISOString();
    for (let i = 0; i < 10; i++) {
      await insertTestEvent(client, ts);
    }

    // Verify rows exist
    const before = await client.unsafe(`SELECT count(*)::int AS count FROM events`);
    expect(before[0].count).toBe(10);

    // 1-byte limit forces row-level deletion
    const result = await dropOldestEventPartitions(client, 1);

    expect(result.droppedPartitions).toEqual([]);
    expect(result.deletedRows).toBeGreaterThan(0);

    await client.end();
  });
});
