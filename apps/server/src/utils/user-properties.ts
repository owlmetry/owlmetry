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
 */
export async function mergeUserProperties(
  db: Db,
  projectId: string,
  userId: string,
  newProps: Record<string, string>,
): Promise<void> {
  await db
    .insert(appUsers)
    .values({
      project_id: projectId,
      user_id: userId,
      is_anonymous: userId.startsWith(ANONYMOUS_ID_PREFIX),
      properties: newProps,
    })
    .onConflictDoUpdate({
      target: [appUsers.project_id, appUsers.user_id],
      set: {
        properties: sql`COALESCE(app_users.properties, '{}'::jsonb) || ${JSON.stringify(newProps)}::jsonb`,
      },
    });
}
