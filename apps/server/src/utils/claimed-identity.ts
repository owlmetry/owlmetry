import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@owlmetry/db";
import { appUsers } from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX } from "@owlmetry/shared";

/**
 * For each incoming user_id that starts with the anonymous prefix, look up
 * any app_users row (scoped to project_id) whose claimed_from array contains it.
 * Returns a map from anon_id → real user_id for those that have been claimed.
 *
 * Closes the race where offline-queued events tagged with an anon id arrive at
 * /v1/ingest after the claim transaction has already committed, which would
 * otherwise re-create an anon app_users row.
 *
 * Implementation: fetches every row in the project that has a non-null
 * claimed_from and filters in JS. That set is bounded — each real signed-in
 * user contributes at most one row and only if they've absorbed an anon id —
 * so it stays small even in large projects. We avoid the jsonb `?|` / text[]
 * parameter-binding path with postgres-js, which mis-encodes small/mixed
 * arrays and triggers "malformed array literal" errors at runtime.
 */
export async function resolveClaimedUserIds(
  db: Db,
  projectId: string,
  incomingUserIds: readonly (string | null | undefined)[]
): Promise<Map<string, string>> {
  const anonIds = new Set<string>();
  for (const id of incomingUserIds) {
    if (typeof id === "string" && id.startsWith(ANONYMOUS_ID_PREFIX)) {
      anonIds.add(id);
    }
  }
  if (anonIds.size === 0) return new Map();

  const rows = await db
    .select({ user_id: appUsers.user_id, claimed_from: appUsers.claimed_from })
    .from(appUsers)
    .where(
      and(eq(appUsers.project_id, projectId), isNotNull(appUsers.claimed_from))
    );

  const map = new Map<string, string>();
  for (const row of rows) {
    if (!row.claimed_from) continue;
    for (const anon of row.claimed_from) {
      if (anonIds.has(anon)) {
        map.set(anon, row.user_id);
      }
    }
  }
  return map;
}
