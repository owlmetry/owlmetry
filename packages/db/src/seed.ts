import { createDatabaseConnection } from "./index.js";
import { users, teams, teamMembers, projects, apps, apiKeys, events, appUsers, appUserApps, metricDefinitions, funnelDefinitions } from "./schema.js";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  console.error("Seed script is for development only. Aborting.");
  process.exit(1);
}

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

type Db = ReturnType<typeof createDatabaseConnection>;

/** Insert a row if it doesn't exist, otherwise select the existing one. Requires a unique constraint on the lookup column(s). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle's table/where types are not easily expressed generically
async function findOrCreate<T>(db: Db, table: any, values: Record<string, unknown>, where: any): Promise<T> {
  const [inserted] = await db.insert(table).values(values).onConflictDoNothing().returning();
  if (inserted) return inserted as T;
  const [existing] = await db.select().from(table).where(where);
  return existing as T;
}

/** Insert an API key if one with the same secret doesn't already exist. */
async function ensureApiKey(db: Db, rawKey: string, values: Omit<typeof apiKeys.$inferInsert, "secret">) {
  const [existing] = await db.select().from(apiKeys).where(eq(apiKeys.secret, rawKey));
  if (!existing) {
    await db.insert(apiKeys).values({
      ...values,
      secret: rawKey,
    });
  }
}

async function main() {
  const db = createDatabaseConnection(url);

  console.log("Seeding database...");

  // --- User ---
  const user = await findOrCreate<typeof users.$inferSelect>(
    db, users,
    { email: "admin@owlmetry.com", name: "Admin" },
    eq(users.email, "admin@owlmetry.com"),
  );
  console.log(`  User:    ${user.email} (${user.id})`);

  // --- Team ---
  const team = await findOrCreate<typeof teams.$inferSelect>(
    db, teams,
    { name: "Default Team", slug: "default" },
    eq(teams.slug, "default"),
  );
  console.log(`  Team:    ${team.name} (${team.slug})`);

  // --- Team member ---
  await db.insert(teamMembers).values({
    team_id: team.id,
    user_id: user.id,
    role: "owner",
  }).onConflictDoNothing();

  // --- Project ---
  const project = await findOrCreate<typeof projects.$inferSelect>(
    db, projects,
    { team_id: team.id, name: "Demo Project", slug: "demo" },
    and(eq(projects.team_id, team.id), eq(projects.slug, "demo")),
  );
  console.log(`  Project: ${project.name} (${project.slug})`);

  // --- Demo app (apple) ---
  const clientKey = "owl_client_demo_000000000000000000000000000000000000000000";

  let [app] = await db.select().from(apps).where(and(eq(apps.project_id, project.id), eq(apps.name, "Demo App")));
  if (!app) {
    [app] = await db.insert(apps).values({
      team_id: team.id,
      project_id: project.id,
      name: "Demo App",
      platform: "apple",
      bundle_id: "com.owlmetry.demo",
    }).returning();
  }
  console.log(`  App:     ${app.name} (${app.id})`);

  await ensureApiKey(db, clientKey, {
    key_type: "client", app_id: app.id, team_id: team.id,
    name: "Demo Client Key", created_by: user.id, permissions: ["events:write"],
  });

  // --- Agent API key ---
  const agentKey = "owl_agent_demo_000000000000000000000000000000000000000000";
  await ensureApiKey(db, agentKey, {
    key_type: "agent", app_id: null, team_id: team.id,
    name: "Demo Agent Key", created_by: user.id,
    permissions: ["events:read", "funnels:read", "apps:read", "projects:read", "metrics:read"],
  });

  // --- Demo server app (backend) ---
  const serverAppKey = "owl_client_svr_0000000000000000000000000000000000000000";

  let [serverApp] = await db.select().from(apps).where(and(eq(apps.project_id, project.id), eq(apps.name, "Demo API Server")));
  if (!serverApp) {
    [serverApp] = await db.insert(apps).values({
      team_id: team.id,
      project_id: project.id,
      name: "Demo API Server",
      platform: "backend",
      bundle_id: null,
    }).returning();
  }
  console.log(`  Server:  ${serverApp.name} (${serverApp.id})`);

  await ensureApiKey(db, serverAppKey, {
    key_type: "client", app_id: serverApp.id, team_id: team.id,
    name: "Demo API Server Client Key", created_by: user.id, permissions: ["events:write"],
  });

  // --- Seed demo events (always fresh) ---
  const session1 = crypto.randomUUID();
  const session2 = crypto.randomUUID();
  const now = Date.now();

  const seedEvents: Array<Omit<typeof events.$inferInsert, "app_id">> = [
    { session_id: session1, level: "info", message: "App launched", screen_name: "HomeScreen", user_id: "user-42", source_module: "AppDelegate", environment: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 8 * 60000) },
    { session_id: session1, level: "debug", message: "Loading user preferences", screen_name: "HomeScreen", user_id: "user-42", source_module: "PrefsManager", environment: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 7 * 60000) },
    { session_id: session1, level: "info", message: "Dashboard rendered", screen_name: "Dashboard", user_id: "user-42", source_module: "DashboardVC", environment: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 6 * 60000) },
    { session_id: session1, level: "warn", message: "Slow network response: 2.3s", screen_name: "Dashboard", user_id: "user-42", source_module: "NetworkManager", environment: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 5 * 60000) },
    { session_id: session1, level: "error", message: "Failed to load profile image: 404", screen_name: "ProfileScreen", user_id: "user-42", source_module: "ImageLoader", environment: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 4 * 60000) },
    { session_id: session1, level: "info", message: "metric:onboarding:record", screen_name: "OnboardingScreen", user_id: "user-42", source_module: "OwlMetry", environment: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 3 * 60000), custom_attributes: { metric_slug: "onboarding", phase: "record" } },
    { session_id: session1, level: "warn", message: "User skipped onboarding step 3", screen_name: "OnboardingScreen", user_id: "user-42", source_module: "OnboardingVC", environment: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 2 * 60000), custom_attributes: { step: "3", reason: "skipped" } },
    { session_id: session2, level: "info", message: "App launched", screen_name: "HomeScreen", user_id: "user-99", source_module: "AppDelegate", environment: "ios", os_version: "18.2", app_version: "1.0.0", device_model: "iPhone 15 Pro", locale: "en_US", timestamp: new Date(now - 90000) },
    { session_id: session2, level: "info", message: "Search performed", screen_name: "SearchScreen", user_id: "user-99", source_module: "SearchVC", environment: "ios", os_version: "18.2", app_version: "1.0.0", device_model: "iPhone 15 Pro", locale: "en_US", timestamp: new Date(now - 60000), custom_attributes: { query: "weather", results_count: "12" } },
    { session_id: session2, level: "error", message: "Crash in search results rendering", screen_name: "SearchScreen", user_id: "user-99", source_module: "SearchResultsVC", environment: "ios", os_version: "18.2", app_version: "1.0.0", device_model: "iPhone 15 Pro", locale: "en_US", timestamp: new Date(now - 30000) },
  ];

  await db.insert(events).values(
    seedEvents.map((e) => ({ ...e, app_id: app.id }))
  );

  // Server events
  const serverSession = crypto.randomUUID();
  const serverEvents: Array<Omit<typeof events.$inferInsert, "app_id">> = [
    { session_id: serverSession, level: "info", message: "Server started on port 4000", screen_name: "", user_id: "", source_module: "index.ts:42", environment: "backend", os_version: "Node.js 22.0.0", app_version: "1.0.0", device_model: "", locale: "", timestamp: new Date(now - 10 * 60000) },
    { session_id: serverSession, level: "info", message: "User authenticated successfully", screen_name: "", user_id: "user-42", source_module: "auth.ts:118", environment: "backend", os_version: "Node.js 22.0.0", app_version: "1.0.0", device_model: "", locale: "", timestamp: new Date(now - 9 * 60000), custom_attributes: { route: "/v1/auth/login", method: "POST" } },
    { session_id: serverSession, level: "error", message: "Database connection timeout after 30s", screen_name: "", user_id: "", source_module: "db.ts:55", environment: "backend", os_version: "Node.js 22.0.0", app_version: "1.0.0", device_model: "", locale: "", timestamp: new Date(now - 1 * 60000), custom_attributes: { pool_size: "10", active_connections: "10" } },
  ];

  await db.insert(events).values(
    serverEvents.map((e) => ({ ...e, app_id: serverApp.id }))
  );

  // --- Metric definitions ---
  await db.insert(metricDefinitions).values([
    {
      project_id: project.id,
      name: "Photo Conversion",
      slug: "photo-conversion",
      description: "Tracks photo format conversion operations",
      documentation: "## Photo Conversion\n\nTracks HEIC to JPEG conversion operations including duration and output size.",
      aggregation_rules: { lifecycle: true, size_field: "output_size" },
    },
    {
      project_id: project.id,
      name: "Checkout",
      slug: "checkout",
      description: "Tracks checkout flow completion",
      aggregation_rules: { lifecycle: true },
    },
  ]).onConflictDoNothing();

  // --- Funnel definitions ---
  await db.insert(funnelDefinitions).values([
    {
      project_id: project.id,
      name: "Onboarding",
      slug: "onboarding",
      description: "Tracks user progression through the onboarding flow",
      steps: [
        { name: "Welcome Screen", event_filter: { step_name: "welcome-screen" } },
        { name: "Create Account", event_filter: { step_name: "create-account" } },
        { name: "Complete Profile", event_filter: { step_name: "complete-profile" } },
        { name: "First Post", event_filter: { step_name: "first-post" } },
      ],
    },
  ]).onConflictDoNothing();

  // --- App users (project-scoped) + junction entries ---
  const seedUserRows = [
    { user_id: "user-42", is_anonymous: false, first_seen_at: new Date(now - 8 * 60000), last_seen_at: new Date(now - 2 * 60000), appId: app.id },
    { user_id: "user-99", is_anonymous: false, first_seen_at: new Date(now - 90000), last_seen_at: new Date(now - 30000), appId: app.id },
    { user_id: "owl_anon_demo-visitor", is_anonymous: true, first_seen_at: new Date(now - 120000), last_seen_at: new Date(), appId: app.id },
  ];
  for (const row of seedUserRows) {
    const [upserted] = await db
      .insert(appUsers)
      .values({
        project_id: project.id,
        user_id: row.user_id,
        is_anonymous: row.is_anonymous,
        first_seen_at: row.first_seen_at,
        last_seen_at: row.last_seen_at,
      })
      .onConflictDoNothing()
      .returning({ id: appUsers.id });

    if (upserted) {
      await db
        .insert(appUserApps)
        .values({ app_user_id: upserted.id, app_id: row.appId, first_seen_at: row.first_seen_at, last_seen_at: row.last_seen_at })
        .onConflictDoNothing();
    }
  }

  console.log("\nSeed complete!");
  console.log(`  Client Key: ${clientKey}`);
  console.log(`  Server Key: ${serverAppKey}`);
  console.log(`  Agent Key:  ${agentKey}`);
  console.log(`  Events:     ${seedEvents.length + serverEvents.length} demo events inserted`);
  console.log("\nRe-run safely at any time — existing data is preserved, fresh events are added.");

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
