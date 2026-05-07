import { sql, type SQL } from "drizzle-orm";

/**
 * SQL predicate for the `paid` billing tier — users on an auto-renewing paid
 * subscription right now (`rc_subscriber='true'` AND not in trial). Excludes
 * trials (no revenue yet) and cancelled-but-still-in-period users (won't
 * renew; `rc_subscriber` flips to false on cancellation).
 *
 * Parameterized over the JSONB `properties` expression so the same predicate
 * works in both contexts:
 * - Direct table queries with joins — pass `sql`${appUsers.properties}`` so
 *   the column resolves unambiguously (`routes/app-users.ts`
 *   `buildBillingStatusCondition`, used by the `billing_status` filter).
 * - CTE contexts that select from a single `app_users` source — pass
 *   `sql`properties`` (`routes/ads.ts` `retained_user_count` FILTER, used by
 *   the Retained column on the Advertising insights dashboard).
 *
 * One source of truth — if the predicate ever changes (e.g. a new
 * `rc_period_type` value joins `'trial'`), every billing-tier surface picks
 * it up.
 */
export function paidTierPredicate(propertiesExpr: SQL): SQL {
  return sql`(${propertiesExpr})->>'rc_subscriber' = 'true' AND ((${propertiesExpr})->>'rc_period_type') IS DISTINCT FROM 'trial'`;
}
