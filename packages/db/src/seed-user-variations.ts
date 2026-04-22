import { createDatabaseConnection } from "./index.js";
import { projects, apps, appUsers, appUserApps, users, teamMembers, teams } from "./schema.js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  console.error("Seed script is for development only. Aborting.");
  process.exit(1);
}

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

// Prefixed so reruns can cleanly delete-and-reinsert these specific users
// without touching real seed data (user-42, user-99, owl_anon_demo-visitor).
const USER_ID_PREFIX = "test_variation_";

interface SeededUser {
  user_id: string;
  properties: Record<string, string>;
  country: string | null;
  /** Offset in minutes subtracted from `now` for first_seen_at. */
  offsetMinutes: number;
  note: string;
}

const USERS: SeededUser[] = [
  {
    user_id: `${USER_ID_PREFIX}paid_asa_full`,
    note: "💰 Paid + 🎯 ASA (every asa_* field) + rc_last_purchase + 4 other props",
    country: "US",
    offsetMinutes: 1,
    properties: {
      rc_subscriber: "true",
      rc_status: "active",
      rc_will_renew: "true",
      rc_period_type: "normal",
      rc_entitlements: "pro",
      rc_product: "com.owlmetry.demo.pro.yearly",
      rc_billing_period: "2026-04-01_2027-04-01",
      rc_last_purchase: "39.99 USD",
      attribution_source: "apple_search_ads",
      asa_campaign_id: "1234567890",
      asa_campaign_name: "Spring Launch US",
      asa_ad_group_id: "9876543210",
      asa_ad_group_name: "Pro features",
      asa_keyword_id: "5555555555",
      asa_keyword: "habit tracker",
      asa_ad_id: "1111222233",
      asa_ad_name: "Hero video",
      asa_creative_set_id: "44445555",
      asa_claim_type: "click",
      plan: "pro",
      locale: "en_US",
      onboarding_completed: "true",
      favorite_feature: "habits",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}paid_asa_partial`,
    note: "💰 Paid + 🎯 ASA (IDs only, no names resolved yet) + no other props",
    country: "DE",
    offsetMinutes: 2,
    properties: {
      rc_subscriber: "true",
      rc_status: "active",
      rc_will_renew: "true",
      rc_period_type: "normal",
      rc_entitlements: "pro",
      rc_product: "com.owlmetry.demo.pro.monthly",
      rc_billing_period: "2026-04-05_2026-05-05",
      attribution_source: "apple_search_ads",
      asa_campaign_id: "2222333344",
      asa_ad_group_id: "4444555566",
      asa_claim_type: "click",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}trial_active`,
    note: "🎁 Trial (sky, active) + 🎯 ASA + 2 other props",
    country: "JP",
    offsetMinutes: 3,
    properties: {
      rc_subscriber: "true",
      rc_status: "trialing",
      rc_will_renew: "true",
      rc_period_type: "trial",
      rc_entitlements: "pro",
      rc_product: "com.owlmetry.demo.pro.yearly",
      rc_billing_period: "2026-04-20_2026-04-27",
      attribution_source: "apple_search_ads",
      asa_campaign_id: "7777888899",
      asa_campaign_name: "JP Expansion",
      asa_ad_group_id: "3333444455",
      asa_ad_group_name: "Brand",
      asa_claim_type: "impression",
      locale: "ja_JP",
      push_opt_in: "true",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}trial_cancelled`,
    note: "🎁 Trial (red, cancelled) + 🌱 Organic + 1 other prop",
    country: "GB",
    offsetMinutes: 4,
    properties: {
      rc_subscriber: "false",
      rc_status: "trialing",
      rc_will_renew: "false",
      rc_period_type: "trial",
      rc_entitlements: "pro",
      rc_product: "com.owlmetry.demo.pro.yearly",
      rc_billing_period: "2026-04-19_2026-04-26",
      attribution_source: "none",
      referral_source: "friend",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}paid_cancelled`,
    note: "Only secondary 'Cancelled' badge (no primary) + 🎯 ASA + 3 other props",
    country: "FR",
    offsetMinutes: 5,
    properties: {
      rc_subscriber: "false",
      rc_status: "cancelled",
      rc_will_renew: "false",
      rc_period_type: "normal",
      rc_entitlements: "pro",
      rc_product: "com.owlmetry.demo.pro.monthly",
      rc_billing_period: "2026-04-10_2026-05-10",
      rc_last_purchase: "4.99 EUR",
      attribution_source: "apple_search_ads",
      asa_campaign_id: "6666777788",
      asa_campaign_name: "FR Retention",
      asa_keyword_id: "8888999900",
      asa_keyword: "meditation",
      asa_claim_type: "click",
      plan: "pro",
      last_screen: "settings",
      churn_reason: "price",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}organic_only`,
    note: "No billing + 🌱 Organic + 2 other props",
    country: "CA",
    offsetMinutes: 6,
    properties: {
      attribution_source: "none",
      locale: "en_CA",
      device_class: "phone",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}props_only`,
    note: "No billing + no attribution (still pending / disabled) + 3 other props",
    country: null,
    offsetMinutes: 7,
    properties: {
      locale: "en_AU",
      theme: "dark",
      first_session_duration_seconds: "87",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}many_props`,
    note: "🎁 Trial + 🎯 ASA + 10 other props (tests overflow tooltip)",
    country: "AU",
    offsetMinutes: 8,
    properties: {
      rc_subscriber: "true",
      rc_status: "trialing",
      rc_will_renew: "true",
      rc_period_type: "trial",
      rc_entitlements: "pro,cloud_sync",
      attribution_source: "apple_search_ads",
      asa_campaign_id: "1010101010",
      asa_campaign_name: "ANZ Launch",
      asa_claim_type: "click",
      plan: "pro",
      locale: "en_AU",
      onboarding_completed: "true",
      push_opt_in: "false",
      theme: "system",
      notifications_enabled: "true",
      beta_tester: "true",
      signup_referrer: "podcast",
      marketing_opt_in: "false",
      preferred_units: "metric",
      habit_count: "12",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}empty`,
    note: "No properties at all — Properties column renders empty",
    country: "BR",
    offsetMinutes: 9,
    properties: {},
  },
  {
    user_id: `${USER_ID_PREFIX}minimal_paid`,
    note: "💰 Paid + no attribution + rc_last_purchase, nothing else",
    country: "NL",
    offsetMinutes: 10,
    properties: {
      rc_subscriber: "true",
      rc_status: "active",
      rc_will_renew: "true",
      rc_period_type: "normal",
      rc_entitlements: "pro",
      rc_billing_period: "2026-04-15_2026-05-15",
      rc_last_purchase: "4.99 EUR",
    },
  },
];

async function resolveTarget(db: ReturnType<typeof createDatabaseConnection>) {
  // Optional CLI arg: project slug. Default: jayvdb1@gmail.com's first project.
  const slugArg = process.argv[2];
  const emailDefault = "jayvdb1@gmail.com";

  if (slugArg) {
    const [project] = await db.select().from(projects).where(eq(projects.slug, slugArg));
    if (!project || project.deleted_at) {
      console.error(`Project with slug "${slugArg}" not found.`);
      process.exit(1);
    }
    return project;
  }

  const [u] = await db.select().from(users).where(eq(users.email, emailDefault));
  if (!u) {
    console.error(`User ${emailDefault} not found. Pass a project slug as argv[2] to override.`);
    process.exit(1);
  }
  const memberships = await db
    .select({ team_id: teamMembers.team_id })
    .from(teamMembers)
    .where(eq(teamMembers.user_id, u.id));
  if (memberships.length === 0) {
    console.error(`User ${emailDefault} has no team memberships.`);
    process.exit(1);
  }
  const teamIds = memberships.map((m) => m.team_id);
  const candidateProjects = await db
    .select()
    .from(projects)
    .where(and(inArray(projects.team_id, teamIds), isNull(projects.deleted_at)));
  if (candidateProjects.length === 0) {
    console.error(`No active projects in teams for ${emailDefault}.`);
    process.exit(1);
  }
  // Prefer personal (non-"default") team so we don't land back in the shared
  // seed's Demo Project when the user is actually viewing their own team.
  const teamRows = await db.select().from(teams).where(inArray(teams.id, teamIds));
  const personal = teamRows.find((t) => t.slug !== "default");
  const preferredTeamId = personal?.id;
  const chosen = preferredTeamId
    ? candidateProjects.find((p) => p.team_id === preferredTeamId) ?? candidateProjects[0]
    : candidateProjects[0];
  return chosen;
}

async function main() {
  const db = createDatabaseConnection(url);

  const project = await resolveTarget(db);

  // Include soft-deleted apps — in dev the only app in a test project may be
  // soft-deleted, and the /dashboard/users list still renders its badge.
  const projectApps = await db
    .select()
    .from(apps)
    .where(eq(apps.project_id, project.id));
  const demoApp = projectApps.find((a) => !a.deleted_at) ?? projectApps[0];
  if (!demoApp) {
    console.warn(`No apps in project "${project.name}" — users will have no app badge.`);
  }

  console.log(`Project: ${project.name} (${project.id})`);
  if (demoApp) console.log(`App:     ${demoApp.name} (${demoApp.id})`);

  // Delete any stray test_variation_* users across ALL projects (not just the
  // target), so reruns clean up mistakes from earlier runs that landed in a
  // different project.
  const userIds = USERS.map((u) => u.user_id);
  const deleted = await db
    .delete(appUsers)
    .where(inArray(appUsers.user_id, userIds))
    .returning({ id: appUsers.id });
  if (deleted.length > 0) {
    console.log(`Removed ${deleted.length} existing test_variation_* users (cascaded).`);
  }

  const now = Date.now();

  for (const u of USERS) {
    const seenAt = new Date(now - u.offsetMinutes * 60_000);
    const [inserted] = await db
      .insert(appUsers)
      .values({
        project_id: project.id,
        user_id: u.user_id,
        is_anonymous: false,
        properties: u.properties,
        first_seen_at: seenAt,
        last_seen_at: seenAt,
        last_country_code: u.country,
      })
      .returning({ id: appUsers.id });

    if (demoApp) {
      await db.insert(appUserApps).values({
        app_user_id: inserted.id,
        app_id: demoApp.id,
        first_seen_at: seenAt,
        last_seen_at: seenAt,
      });
    }

    console.log(`  ${u.user_id.padEnd(38)} — ${u.note}`);
  }

  console.log(`\nSeeded ${USERS.length} test_variation_* users in Demo Project.`);
  console.log("Visit http://localhost:3000/dashboard/users?sort=first_seen to test.");

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
