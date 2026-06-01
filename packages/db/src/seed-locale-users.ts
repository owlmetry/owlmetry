/**
 * Seed a realistic, skewed population of `app_users` with locale + country
 * signals so the /dashboard/locales page (and the new Users-table columns) can
 * be eyeballed on localhost before the SDK that captures preferred language
 * ships — and before any real data exists.
 *
 * Each non-backend app in the local DB gets ~200 synthetic users with:
 *   - `last_country_code`           — weighted spread across real markets.
 *   - `last_preferred_language`     — the *wanted* language (fr-FR, fr-CA, fr,
 *                                     pt-BR, ja, es-MX…); a chunk left NULL to
 *                                     simulate users not yet on the new SDK, so
 *                                     the "country bridges until adoption" story
 *                                     is visible.
 *   - `last_locale`                 — the *shown* locale: the wanted language
 *                                     only when the app ships it, else English
 *                                     in the user's region (e.g. en_FR) — mirrors
 *                                     real iOS resolution so shown≠wanted shows.
 * Seeded apps get `supported_languages = ['en','de']` (source 'sdk') so demand
 * for fr / pt / ja / es / … lights up as 🔴 NOT SHIPPED and the gap tool has
 * something to flag.
 *
 * Idempotent: stable synthetic user_ids + ON CONFLICT DO UPDATE, so re-running
 * refreshes values rather than duplicating users.
 *
 * Usage: `pnpm dev:seed-locale-users` (run after `pnpm dev:seed`).
 */
import { createDatabaseConnection } from "./index.js";
import { apps, appUsers, appUserApps } from "./schema.js";
import { ANONYMOUS_ID_PREFIX, baseLanguage } from "@owlmetry/shared";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  console.error("seed-locale-users is for development only. Aborting.");
  process.exit(1);
}

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

const USERS_PER_APP = 200;
// Fraction of users left without a preferred language (simulates devices still
// on a pre-locale-capture SDK build) — they only contribute to the country panel.
const NULL_PREFERRED_FRACTION = 0.35;
// What the seeded apps "ship". Anything outside this set is unmet demand.
const SUPPORTED_LANGUAGES = ["en", "de"];

// (country, preferred-language, weight). Mix of region-tagged and bare tags so
// the full-locale breakdown shows both fr-FR/fr-CA and plain fr.
const DISTRIBUTION: Array<[country: string, lang: string, weight: number]> = [
  ["US", "en-US", 30],
  ["GB", "en-GB", 8],
  ["IN", "en-IN", 5],
  ["AU", "en-AU", 3],
  ["FR", "fr-FR", 12],
  ["CA", "fr-CA", 4],
  ["FR", "fr", 3],
  ["DE", "de-DE", 10],
  ["AT", "de", 2],
  ["BR", "pt-BR", 9],
  ["PT", "pt-PT", 2],
  ["JP", "ja", 7],
  ["MX", "es-MX", 6],
  ["ES", "es-ES", 4],
  ["IT", "it-IT", 3],
  ["NL", "nl-NL", 2],
  ["KR", "ko-KR", 3],
  ["CN", "zh-Hans-CN", 4],
  ["TW", "zh-Hant-TW", 2],
  ["RU", "ru-RU", 3],
  ["SE", "sv-SE", 1],
];

const WEIGHT_TOTAL = DISTRIBUTION.reduce((s, [, , w]) => s + w, 0);

function pick(): [country: string, lang: string] {
  let r = Math.random() * WEIGHT_TOTAL;
  for (const [country, lang, weight] of DISTRIBUTION) {
    r -= weight;
    if (r <= 0) return [country, lang];
  }
  const [country, lang] = DISTRIBUTION[0];
  return [country, lang];
}

/** Shown locale = wanted language if shipped, else English, in the user's region. */
function shownLocale(prefLang: string, country: string): string {
  const base = baseLanguage(prefLang);
  const shown = SUPPORTED_LANGUAGES.includes(base) ? base : "en";
  return `${shown}_${country}`;
}

async function main() {
  const db = createDatabaseConnection(url);

  const appRows = await db
    .select({
      id: apps.id,
      project_id: apps.project_id,
      name: apps.name,
      platform: apps.platform,
    })
    .from(apps)
    .where(and(isNull(apps.deleted_at), ne(apps.platform, "backend")));

  if (appRows.length === 0) {
    console.log("No non-backend apps found — run `pnpm dev:seed` first.");
    process.exit(0);
  }

  console.log(`Seeding locale users for ${appRows.length} app(s)…`);

  for (const app of appRows) {
    const short = app.id.slice(0, 8);
    const rows = [];
    for (let i = 0; i < USERS_PER_APP; i++) {
      const [country, prefLang] = pick();
      const isReal = Math.random() < 0.3;
      const userId = isReal
        ? `seedlocale_${short}_${i}`
        : `${ANONYMOUS_ID_PREFIX}seedlocale_${short}_${i}`;
      const hasPreferred = Math.random() >= NULL_PREFERRED_FRACTION;
      rows.push({
        project_id: app.project_id,
        user_id: userId,
        is_anonymous: !isReal,
        last_country_code: country,
        last_locale: shownLocale(prefLang, country),
        last_preferred_language: hasPreferred ? prefLang : null,
      });
    }

    const upserted = await db
      .insert(appUsers)
      .values(rows)
      .onConflictDoUpdate({
        target: [appUsers.project_id, appUsers.user_id],
        set: {
          last_country_code: sql`excluded.last_country_code`,
          last_locale: sql`excluded.last_locale`,
          last_preferred_language: sql`excluded.last_preferred_language`,
        },
      })
      .returning({ id: appUsers.id });

    // Link every seeded user to this app (junction), idempotently.
    const junction = upserted.map((u) => ({ app_user_id: u.id, app_id: app.id }));
    // Insert in chunks to stay well under Postgres's bind-parameter ceiling.
    for (let i = 0; i < junction.length; i += 500) {
      await db
        .insert(appUserApps)
        .values(junction.slice(i, i + 500))
        .onConflictDoNothing();
    }

    await db
      .update(apps)
      .set({
        supported_languages: SUPPORTED_LANGUAGES,
        supported_languages_source: "sdk",
      })
      .where(eq(apps.id, app.id));

    console.log(`  ${app.name} (${short}…): ${USERS_PER_APP} users, ships [${SUPPORTED_LANGUAGES.join(", ")}]`);
  }

  console.log("done — open /dashboard/locales to see the breakdown + gap flags.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
