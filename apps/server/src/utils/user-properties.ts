import { and, eq, sql } from "drizzle-orm";
import { appUsers } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX } from "@owlmetry/shared";

/**
 * Keep only entries whose destination slot is currently unset on `current`.
 * Used by the RC attribution backfill paths to avoid overwriting data the
 * Swift SDK's live AdServices flow (or an earlier sync) already wrote.
 * Treats undefined, null, and empty string all as "unset" — matches the
 * delete-on-empty semantics of the user-properties endpoint.
 */
export function selectUnsetProps(
  candidate: Record<string, string>,
  current: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(candidate).filter(([key]) => {
      const existing = current[key];
      return existing === undefined || existing === null || existing === "";
    }),
  );
}

/**
 * Merge properties into a user's existing properties via a single upsert.
 * Creates the app_users row if it doesn't exist. Race-condition safe via
 * ON CONFLICT DO UPDATE with JSONB merge.
 *
 * Optionally writes typed denormalised columns (today: `total_revenue_usd_cents`
 * + `revenue_synced_at`) in the same statement so RC sync only does one write
 * per user instead of merge-then-update.
 */
export async function mergeUserProperties(
  db: Db,
  projectId: string,
  userId: string,
  newProps: Record<string, string>,
  typedColumns?: {
    total_revenue_usd_cents?: number | null;
    revenue_synced_at?: Date | null;
  },
): Promise<void> {
  const insertValues: typeof appUsers.$inferInsert = {
    project_id: projectId,
    user_id: userId,
    is_anonymous: userId.startsWith(ANONYMOUS_ID_PREFIX),
    properties: newProps,
  };
  const updateSet: Record<string, unknown> = {
    properties: sql`COALESCE(app_users.properties, '{}'::jsonb) || ${JSON.stringify(newProps)}::jsonb`,
  };
  if (typedColumns?.total_revenue_usd_cents !== undefined) {
    insertValues.total_revenue_usd_cents = typedColumns.total_revenue_usd_cents;
    updateSet.total_revenue_usd_cents = typedColumns.total_revenue_usd_cents;
  }
  if (typedColumns?.revenue_synced_at !== undefined) {
    insertValues.revenue_synced_at = typedColumns.revenue_synced_at;
    updateSet.revenue_synced_at = typedColumns.revenue_synced_at;
  }
  await db
    .insert(appUsers)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [appUsers.project_id, appUsers.user_id],
      set: updateSet,
    });
}
