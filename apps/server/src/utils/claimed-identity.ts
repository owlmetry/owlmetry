import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "@owlmetry/db";
import { appUsers, appUserApps } from "@owlmetry/db";
import { ANONYMOUS_ID_PREFIX } from "@owlmetry/shared";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type AppUserRow = typeof appUsers.$inferSelect;

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

/**
 * Fold an anon app_users row into its claimed real row, inside the caller's
 * transaction: earliest first_seen_at wins, real properties win on key
 * conflict, junction rows carry LEAST/GREATEST seen timestamps, anon row
 * deleted (cascades its junction entries). Single source of the merge
 * semantics — shared by the claim handler's merge branch and the straggler
 * sweep below so the two can't drift. `extraRealRowUpdates` lets the claim
 * handler fold its claimed_from append into the same UPDATE.
 */
export async function mergeAnonAppUserRowIntoReal(
  tx: Tx,
  anonRow: AppUserRow,
  realRow: AppUserRow,
  extraRealRowUpdates: Record<string, unknown> = {},
): Promise<void> {
  const updates: Record<string, unknown> = { ...extraRealRowUpdates };
  if (anonRow.first_seen_at < realRow.first_seen_at) {
    updates.first_seen_at = anonRow.first_seen_at;
  }
  // Merge properties: anonymous props as base, real user props win on conflict
  if (anonRow.properties) {
    const anonProps = anonRow.properties as Record<string, string>;
    const realProps = (realRow.properties as Record<string, string>) ?? {};
    updates.properties = { ...anonProps, ...realProps };
  }
  if (Object.keys(updates).length > 0) {
    await tx.update(appUsers).set(updates).where(eq(appUsers.id, realRow.id));
  }

  const anonJunctions = await tx
    .select()
    .from(appUserApps)
    .where(eq(appUserApps.app_user_id, anonRow.id));
  if (anonJunctions.length > 0) {
    await tx
      .insert(appUserApps)
      .values(
        anonJunctions.map((j) => ({
          app_user_id: realRow.id,
          app_id: j.app_id,
          first_seen_at: j.first_seen_at,
          last_seen_at: j.last_seen_at,
        })),
      )
      .onConflictDoUpdate({
        target: [appUserApps.app_user_id, appUserApps.app_id],
        set: {
          first_seen_at: sql`LEAST(${appUserApps.first_seen_at}, EXCLUDED.first_seen_at)`,
          last_seen_at: sql`GREATEST(${appUserApps.last_seen_at}, EXCLUDED.last_seen_at)`,
        },
      });
  }

  // Delete the anonymous row (cascades junction entries)
  await tx.delete(appUsers).where(eq(appUsers.id, anonRow.id));
}

/**
 * Merge straggler anon app_users rows into their claimed real rows.
 *
 * A claim can commit inside another ingest's resolve→upsert window: that
 * ingest's resolveClaimedUserIds saw no mapping (the claim hadn't committed
 * yet), then its awaited upsertAppUsers re-INSERTed the anon row the claim
 * had just renamed/deleted — an orphan with claimed_from = null that no
 * later request would ever clean up. The next ingest carrying the same anon
 * id lands here (its own batch is already rewritten via
 * resolveClaimedUserIds, and its event-table sweep handles the orphaned
 * sibling events) — fold the orphan app_users row back into the real row.
 *
 * Best-effort per mapping (mirrors upsertAppUsers): the incoming batch is
 * already rewritten and committed, so a blip here just leaves the orphan
 * for the next straggler ingest to sweep.
 */
export async function mergeStragglerAnonAppUserRows(
  db: Db,
  projectId: string,
  claimedMap: ReadonlyMap<string, string>,
  log: FastifyBaseLogger,
): Promise<void> {
  if (claimedMap.size === 0) return;

  // The orphan-recreation race is rare, so the common case is "nothing to
  // merge" — probe with one transaction-free SELECT instead of paying a
  // per-mapping transaction just to discover that.
  const orphanRows = await db
    .select({ user_id: appUsers.user_id })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.project_id, projectId),
        inArray(appUsers.user_id, [...claimedMap.keys()]),
      ),
    );

  for (const { user_id: anonId } of orphanRows) {
    const realId = claimedMap.get(anonId);
    if (!realId) continue;
    try {
      await db.transaction(async (tx) => {
        // Re-select inside the transaction — the probe above is unlocked.
        const [anonRow] = await tx
          .select()
          .from(appUsers)
          .where(and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, anonId)))
          .limit(1);
        if (!anonRow) return;

        const [realRow] = await tx
          .select()
          .from(appUsers)
          .where(and(eq(appUsers.project_id, projectId), eq(appUsers.user_id, realId)))
          .limit(1);
        // The mapping was read off the real row earlier in this request; it
        // vanishing mid-request means a concurrent hard-delete — leave the
        // anon row for the next sweep rather than guess at intent.
        if (!realRow) return;

        await mergeAnonAppUserRowIntoReal(tx, anonRow, realRow);
      });
    } catch (err) {
      log.warn(
        { err, anonId, realId, projectId },
        "Failed to merge straggler anon app_users row",
      );
    }
  }
}
