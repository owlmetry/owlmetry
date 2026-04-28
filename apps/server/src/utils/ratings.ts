import { sql } from "drizzle-orm";
import { appStoreRatings } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";

const APP_STORE = "app_store" as const;

// Per-app worldwide rating delta keyed by app_id. INNER JOIN ranked-with-itself
// drops countries that lack a previous snapshot, so brand-new countries don't
// inflate the delta. Tombstones (latest=0, previous=N) correctly contribute −N.
// Apps with no app_store snapshots, or only one day of snapshots anywhere,
// produce no row → caller sees `null` via `map.get(id) ?? null`.
export async function getWorldwideRatingDeltaMap(
  db: Db,
  appIds: string[],
): Promise<Map<string, number>> {
  if (appIds.length === 0) return new Map();
  const appIdList = sql.join(
    appIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute<{ app_id: string; delta: number }>(sql`
    WITH ranked AS (
      SELECT app_id, country_code, rating_count,
             ROW_NUMBER() OVER (PARTITION BY app_id, country_code ORDER BY snapshot_date DESC) AS rn
      FROM ${appStoreRatings}
      WHERE app_id IN (${appIdList}) AND store = ${APP_STORE}
    )
    SELECT l.app_id,
           SUM(l.rating_count - p.rating_count)::int AS delta
    FROM ranked l
    JOIN ranked p
      ON p.app_id = l.app_id AND p.country_code = l.country_code AND p.rn = 2
    WHERE l.rn = 1
    GROUP BY l.app_id
  `);
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.app_id, Number(r.delta));
  }
  return map;
}
