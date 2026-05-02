import { and, eq, sql } from "drizzle-orm";
import { appUsers } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import {
  ANONYMOUS_ID_PREFIX,
  ATTRIBUTION_SOURCE_PROPERTY,
  ATTRIBUTION_SOURCE_VALUES,
} from "@owlmetry/shared";

/**
 * Keep only entries whose destination slot is currently unset on `current`.
 * Used by the RC attribution backfill paths to avoid overwriting data the
 * Swift SDK's live AdServices flow (or an earlier sync) already wrote.
 * Treats undefined, null, and empty string all as "unset" — matches the
 * delete-on-empty semantics of the user-properties endpoint.
 *
 * One carve-out: `attribution_source: "none"` is a placeholder written when
 * RC reports the user as organic (typically a project on RC's basic
 * AdServices integration, where `$mediaSource` is never surfaced). A later
 * sync producing a real network value is an upgrade, not an overwrite, so
 * we let it through. Not generalised: `apple_test_install` stays put (Apple's
 * TestFlight fixture never becomes real), and `apple_search_ads` never
 * downgrades to `none` (the value !== "none" guard covers that).
 */
export function selectUnsetProps(
  candidate: Record<string, string>,
  current: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(candidate).filter(([key, value]) => {
      const existing = current[key];
      if (existing === undefined || existing === null || existing === "") return true;
      if (
        key === ATTRIBUTION_SOURCE_PROPERTY &&
        existing === ATTRIBUTION_SOURCE_VALUES.none &&
        value !== ATTRIBUTION_SOURCE_VALUES.none
      ) {
        return true;
      }
      return false;
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
