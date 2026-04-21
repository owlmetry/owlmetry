import { sql } from "drizzle-orm";
import type { Db } from "@owlmetry/db";
import { appUsers } from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX } from "@owlmetry/shared";

/**
 * Resolve incoming anon user_ids to their real user_id via
 * `app_users.claimed_from` (project-scoped).
 *
 * The filter is pushed to Postgres via `jsonb_array_elements_text` + `ANY`
 * so only matching rows are returned — avoids pulling every claimed user in
 * the project on every ingest. The top-level `?|` operator would also work
 * but the postgres-js driver mis-encodes its text[] argument for small
 * arrays, triggering "malformed array literal" errors at runtime.
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

  // Build an explicit ARRAY[…] literal — the postgres-js driver mis-encodes
  // a parameterized JS array in this position, triggering "malformed array
  // literal" at runtime.
  const anonArraySql = sql.join(
    [...anonIds].map((id) => sql`${id}`),
    sql`, `
  );
  const rows = await db
    .select({ user_id: appUsers.user_id, claimed_from: appUsers.claimed_from })
    .from(appUsers)
    .where(
      sql`${appUsers.project_id} = ${projectId}
        AND ${appUsers.claimed_from} IS NOT NULL
        AND jsonb_typeof(${appUsers.claimed_from}) = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${appUsers.claimed_from}) elt
          WHERE elt = ANY(ARRAY[${anonArraySql}]::text[])
        )`
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
