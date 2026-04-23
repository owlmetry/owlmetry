import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { getTableColumns } from "drizzle-orm";
import { events, metricEvents, funnelEvents } from "@owlmetry/db";
import { buildApp, TEST_DB_URL } from "./setup.js";

// apps/server/src/__tests__/setup.ts and packages/db/src/migrate.ts both hardcode
// CREATE TABLE DDL for the partitioned event tables (Drizzle can't express
// PARTITION BY RANGE). This test pins those DDL blocks to the Drizzle schema.

let app: FastifyInstance;
let client: postgres.Sql;

beforeAll(async () => {
  app = await buildApp();
  client = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await client.end();
  await app.close();
});

interface InfoSchemaColumn {
  column_name: string;
  data_type: string;
  udt_name: string;
  character_maximum_length: number | null;
}

async function fetchTableColumns(tableName: string): Promise<Map<string, InfoSchemaColumn>> {
  const rows = await client<InfoSchemaColumn[]>`
    SELECT column_name, data_type, udt_name, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
  `;
  return new Map(rows.map((r) => [r.column_name, r]));
}

interface ExpectedPgType {
  data_type: string;
  udt_name?: string;
  character_maximum_length?: number | null;
}

// Maps a Drizzle column's runtime shape to the (data_type, udt_name, length)
// triple Postgres reports via information_schema.columns.
function expectedPgType(col: any): ExpectedPgType {
  switch (col.columnType) {
    case "PgUUID":
      return { data_type: "uuid", udt_name: "uuid" };
    case "PgText":
      return { data_type: "text", udt_name: "text" };
    case "PgBoolean":
      return { data_type: "boolean", udt_name: "bool" };
    case "PgInteger":
      return { data_type: "integer", udt_name: "int4" };
    case "PgJsonb":
      return { data_type: "jsonb", udt_name: "jsonb" };
    case "PgVarchar":
      return {
        data_type: "character varying",
        udt_name: "varchar",
        character_maximum_length: col.length ?? null,
      };
    case "PgTimestamp":
      return col.withTimezone
        ? { data_type: "timestamp with time zone", udt_name: "timestamptz" }
        : { data_type: "timestamp without time zone", udt_name: "timestamp" };
    case "PgEnumColumn":
      return { data_type: "USER-DEFINED", udt_name: col.enum?.enumName };
    default:
      throw new Error(`Unhandled Drizzle columnType: ${col.columnType}`);
  }
}

function assertParity(tableName: string, drizzleTable: any, actual: Map<string, InfoSchemaColumn>) {
  const drizzleColumns = Object.values(getTableColumns(drizzleTable)) as any[];
  const expectedNames = new Set(drizzleColumns.map((c) => c.name));
  const actualNames = new Set(actual.keys());

  const missing = [...expectedNames].filter((n) => !actualNames.has(n));
  const extra = [...actualNames].filter((n) => !expectedNames.has(n));

  expect(
    missing,
    `${tableName}: columns declared in schema.ts but missing from the partitioned table — likely setup.ts or migrate.ts DDL drift`,
  ).toEqual([]);
  expect(
    extra,
    `${tableName}: columns in the partitioned table that aren't declared in schema.ts`,
  ).toEqual([]);

  const mismatches: string[] = [];
  for (const col of drizzleColumns) {
    const expected = expectedPgType(col);
    const actualCol = actual.get(col.name)!;
    const reasons: string[] = [];
    if (expected.data_type !== actualCol.data_type) {
      reasons.push(`data_type expected=${expected.data_type} actual=${actualCol.data_type}`);
    }
    if (expected.udt_name && expected.udt_name !== actualCol.udt_name) {
      reasons.push(`udt_name expected=${expected.udt_name} actual=${actualCol.udt_name}`);
    }
    if (
      expected.character_maximum_length != null &&
      expected.character_maximum_length !== actualCol.character_maximum_length
    ) {
      reasons.push(
        `length expected=${expected.character_maximum_length} actual=${actualCol.character_maximum_length}`,
      );
    }
    if (reasons.length > 0) {
      mismatches.push(`${col.name}: ${reasons.join(", ")}`);
    }
  }
  expect(mismatches, `${tableName}: column type mismatches`).toEqual([]);
}

describe("partitioned-table schema parity (Drizzle ↔ actual DDL)", () => {
  it("events table matches schema.ts", async () => {
    const actual = await fetchTableColumns("events");
    assertParity("events", events, actual);
  });

  it("metric_events table matches schema.ts", async () => {
    const actual = await fetchTableColumns("metric_events");
    assertParity("metric_events", metricEvents, actual);
  });

  it("funnel_events table matches schema.ts", async () => {
    const actual = await fetchTableColumns("funnel_events");
    assertParity("funnel_events", funnelEvents, actual);
  });
});
