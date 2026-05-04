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
 * Two paths:
 *
 *   1. **ID-anchored** (SDK-attributed users) — joins the lifetime tables on
 *      the numeric `asa_*_id` and refreshes the stored name. Always safe; the
 *      ID is the stable identifier so we know we're updating the right entity.
 *
 *   2. **Name-anchored ad-group fallback** (RC-only users) — RC's AdServices
 *      integration sends `$campaign`/`$adGroup` strings only, no IDs, and RC
 *      freezes attribution at install time so any subsequent rename leaves
 *      stored names stale forever. We anchor on the user's `asa_campaign_name`:
 *      if it still matches a current campaign in `ad_campaign_lifetime` AND
 *      that campaign has exactly one child ad group in `ad_adgroup_lifetime`,
 *      the user must belong to it — refresh `asa_ad_group_name`. Multi-ad-group
 *      campaigns are skipped (no way to disambiguate). Users without an
 *      existing `asa_ad_group_name` are also skipped (don't synthesize names
 *      RC never gave us). Restricted to users *without* `asa_ad_group_id` so
 *      it never overrides the ID-anchored path's answer for SDK users.
 *
 * Skips users whose campaign / ad group is no longer in the lifetime tables
 * (deleted on Apple's side) — historical names stay as a forensic record.
 * Costs zero Apple API calls — the lifetime tables are the data we just synced.
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

  const adGroupIdRows = await db.execute<{ id: string }>(sql`
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

  const adGroupNameRows = await db.execute<{ id: string }>(sql`
    UPDATE app_users u
    SET properties = COALESCE(u.properties, '{}'::jsonb) || jsonb_build_object('asa_ad_group_name', single_ag.ad_group_name::text)
    FROM ad_campaign_lifetime c
    JOIN (
      SELECT campaign_id, MIN(ad_group_name) AS ad_group_name
      FROM ad_adgroup_lifetime
      WHERE project_id = ${projectId} AND network = ${NETWORK} AND ad_group_name IS NOT NULL
      GROUP BY campaign_id
      HAVING COUNT(*) = 1
    ) single_ag ON single_ag.campaign_id = c.campaign_id
    WHERE u.project_id = ${projectId}
      AND c.project_id = ${projectId}
      AND c.network = ${NETWORK}
      AND c.campaign_name IS NOT NULL
      AND u.properties->>'asa_campaign_name' = c.campaign_name
      AND NOT (u.properties ? 'asa_ad_group_id')
      AND u.properties ? 'asa_ad_group_name'
      AND (u.properties->>'asa_ad_group_name') IS DISTINCT FROM single_ag.ad_group_name
    RETURNING u.id
  `);

  return {
    campaign_names_refreshed: campaignRows.length,
    ad_group_names_refreshed: adGroupIdRows.length + adGroupNameRows.length,
  };
}
