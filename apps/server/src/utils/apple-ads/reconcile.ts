import { sql } from "drizzle-orm";
import type { Db } from "@owlmetry/db";
import { ATTRIBUTION_SOURCE_VALUES } from "@owlmetry/shared";

const NETWORK = ATTRIBUTION_SOURCE_VALUES.appleSearchAds;

export interface ReconcileResult {
  campaign_names_refreshed: number;
  ad_group_names_refreshed: number;
}

/**
 * Refresh stale `asa_campaign_name` / `asa_ad_group_name` on
 * `app_users.properties` against `ad_campaign_lifetime` / `ad_adgroup_lifetime`,
 * which have just been refreshed from Apple's Reports API.
 *
 * Why: name enrichment writes once and never updates (`selectUnsetProps` in the
 * names pass gates overwrites). When a campaign or ad group is renamed in
 * Apple, lifetime tables pick up the new name on the next sync, but historical
 * users keep the old name on their properties — and the dashboard buckets users
 * by `COALESCE(asa_*_name, asa_*_id)`, so a renamed entity splits into two
 * phantom rows (old name with users, new name with spend).
 *
 * Joins on the numeric ID (the stable identifier we always have when the SDK
 * captured attribution), so the reconcile only ever changes a name to match
 * Apple's current truth for the same logical entity. Skips users whose
 * campaign / ad group is no longer in the lifetime tables (deleted on Apple's
 * side) so historical names stay as a forensic record. Costs zero Apple API
 * calls — the lifetime tables are the data we just synced.
 */
export async function reconcileAppleAdsLifetimeNames(
  db: Db,
  projectId: string,
): Promise<ReconcileResult> {
  const campaignRows = await db.execute<{ id: string }>(sql`
    UPDATE app_users u
    SET properties = COALESCE(u.properties, '{}'::jsonb) || jsonb_build_object('asa_campaign_name', c.campaign_name::text)
    FROM ad_campaign_lifetime c
    WHERE u.project_id = ${projectId}
      AND c.project_id = ${projectId}
      AND c.network = ${NETWORK}
      AND c.campaign_name IS NOT NULL
      AND u.properties->>'asa_campaign_id' = c.campaign_id
      AND (u.properties->>'asa_campaign_name') IS DISTINCT FROM c.campaign_name
    RETURNING u.id
  `);

  const adGroupRows = await db.execute<{ id: string }>(sql`
    UPDATE app_users u
    SET properties = COALESCE(u.properties, '{}'::jsonb) || jsonb_build_object('asa_ad_group_name', g.ad_group_name::text)
    FROM ad_adgroup_lifetime g
    WHERE u.project_id = ${projectId}
      AND g.project_id = ${projectId}
      AND g.network = ${NETWORK}
      AND g.ad_group_name IS NOT NULL
      AND u.properties->>'asa_ad_group_id' = g.ad_group_id
      AND (u.properties->>'asa_ad_group_name') IS DISTINCT FROM g.ad_group_name
    RETURNING u.id
  `);

  return {
    campaign_names_refreshed: campaignRows.length,
    ad_group_names_refreshed: adGroupRows.length,
  };
}
