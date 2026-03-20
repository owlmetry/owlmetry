import { eq } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { DataMode } from "@owlmetry/shared";

/**
 * Translate a `data_mode` value into a Drizzle condition on an `is_debug` column.
 * Returns `null` when no filtering is needed ("all" mode).
 */
export function dataModeToDrizzle(
  column: PgColumn,
  dataMode: DataMode | undefined,
): SQL | null {
  if (dataMode === "debug") return eq(column, true);
  if (dataMode === "all") return null;
  // Default: production only
  return eq(column, false);
}
