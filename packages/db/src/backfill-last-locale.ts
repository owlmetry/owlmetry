/**
 * Backfill `app_users.last_locale` and `app_users.last_preferred_language` from
 * the most-recent non-null value on each user's events. The Swift SDK has always
 * sent `locale` (Locale.current), so `last_locale` can be populated for every
 * existing user immediately — no SDK upgrade required. `last_preferred_language`
 * only fills in for users whose events already carry it (i.e. after the SDK that
 * captures Locale.preferredLanguages.first ships); until then it stays null and
 * the dashboard's country panel bridges the gap.
 *
 * Idempotent: only touches rows where the target column is still null and a
 * source value exists, so re-running is safe and cheap.
 *
 * Usage: `pnpm dev:backfill-locale` (or with an explicit DATABASE_URL prefix).
 */
import postgres from "postgres";
import "dotenv/config";

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

async function main() {
  const sql = postgres(url, { max: 4 });
  try {
    console.log("Backfilling app_users.last_locale from events.locale…");
    const localeResult = await sql`
      UPDATE app_users au
      SET last_locale = (
        SELECT e.locale FROM events e
        JOIN app_user_apps ua ON ua.app_id = e.app_id
        WHERE ua.app_user_id = au.id
          AND e.user_id = au.user_id
          AND e.locale IS NOT NULL
        ORDER BY e.timestamp DESC
        LIMIT 1
      )
      WHERE au.last_locale IS NULL
        AND EXISTS (
          SELECT 1 FROM events e
          JOIN app_user_apps ua ON ua.app_id = e.app_id
          WHERE ua.app_user_id = au.id
            AND e.user_id = au.user_id
            AND e.locale IS NOT NULL
        )
    `;
    console.log(`  last_locale: updated ${localeResult.count} users`);

    console.log("Backfilling app_users.last_preferred_language from events.preferred_language…");
    const preferredResult = await sql`
      UPDATE app_users au
      SET last_preferred_language = (
        SELECT e.preferred_language FROM events e
        JOIN app_user_apps ua ON ua.app_id = e.app_id
        WHERE ua.app_user_id = au.id
          AND e.user_id = au.user_id
          AND e.preferred_language IS NOT NULL
        ORDER BY e.timestamp DESC
        LIMIT 1
      )
      WHERE au.last_preferred_language IS NULL
        AND EXISTS (
          SELECT 1 FROM events e
          JOIN app_user_apps ua ON ua.app_id = e.app_id
          WHERE ua.app_user_id = au.id
            AND e.user_id = au.user_id
            AND e.preferred_language IS NOT NULL
        )
    `;
    console.log(`  last_preferred_language: updated ${preferredResult.count} users`);
    console.log("Backfill complete.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
