import { and, eq, sql } from "drizzle-orm";
import { appUsers } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX } from "@owlmetry/shared";

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
