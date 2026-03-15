import { createDatabaseConnection } from "./index.js";
import { users, teams, teamMembers, projects, apps, apiKeys, events } from "./schema.js";
import { hashApiKey, KEY_PREFIX_LENGTH } from "@owlmetry/shared";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import "dotenv/config";

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

async function main() {
  const db = createDatabaseConnection(url);

  console.log("Seeding database...");

  // Create default user
  const [user] = await db
    .insert(users)
    .values({
      email: "admin@owlmetry.com",
      password_hash: await bcrypt.hash("H00tH00t", 12),
      name: "Admin",
    })
    .onConflictDoNothing()
    .returning();

  if (!user) {
    console.log("Seed data already exists, skipping.");
    process.exit(0);
  }

  // Create default team
  const [team] = await db
    .insert(teams)
    .values({
      name: "Default Team",
      slug: "default",
    })
    .returning();

  // Add user to team as owner
  await db.insert(teamMembers).values({
    team_id: team.id,
    user_id: user.id,
    role: "owner",
  });

  // Create a demo project
  const [project] = await db
    .insert(projects)
    .values({
      team_id: team.id,
      name: "Demo Project",
      slug: "demo",
    })
    .returning();

  // Create a demo app with deterministic client key (so demo apps can hardcode it)
  const clientKey = "owl_client_demo_000000000000000000000000000000000000000000";
  const [app] = await db
    .insert(apps)
    .values({
      team_id: team.id,
      project_id: project.id,
      name: "Demo App",
      platform: "ios",
      bundle_id: "com.owlmetry.demo",
      client_key: clientKey,
    })
    .returning();
  await db.insert(apiKeys).values({
    key_hash: hashApiKey(clientKey),
    key_prefix: clientKey.slice(0, KEY_PREFIX_LENGTH),
    key_type: "client",
    app_id: app.id,
    team_id: team.id,
    name: "Demo Client Key",
    permissions: ["events:write"],
  });

  // Create agent API key (deterministic so demo apps can hardcode it)
  const agentKey = "owl_agent_demo_000000000000000000000000000000000000000000";
  await db.insert(apiKeys).values({
    key_hash: hashApiKey(agentKey),
    key_prefix: agentKey.slice(0, KEY_PREFIX_LENGTH),
    key_type: "agent",
    app_id: null,
    team_id: team.id,
    name: "Demo Agent Key",
    permissions: ["events:read", "funnels:read", "apps:read", "projects:read"],
  });

  // Seed demo events
  const session1 = crypto.randomUUID();
  const session2 = crypto.randomUUID();
  const now = Date.now();

  type SeedEvent = {
    session_id: string; level: "info" | "debug" | "warn" | "error" | "attention" | "tracking";
    message: string; screen_name: string; user_id: string; source_module: string;
    platform: string; os_version: string; app_version: string; device_model: string;
    locale: string; timestamp: Date; custom_attributes?: Record<string, string>;
  };

  const seedEvents: SeedEvent[] = [
    { session_id: session1, level: "info", message: "App launched", screen_name: "HomeScreen", user_id: "user-42", source_module: "AppDelegate", platform: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 8 * 60000) },
    { session_id: session1, level: "debug", message: "Loading user preferences", screen_name: "HomeScreen", user_id: "user-42", source_module: "PrefsManager", platform: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 7 * 60000) },
    { session_id: session1, level: "info", message: "Dashboard rendered", screen_name: "Dashboard", user_id: "user-42", source_module: "DashboardVC", platform: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 6 * 60000) },
    { session_id: session1, level: "warn", message: "Slow network response: 2.3s", screen_name: "Dashboard", user_id: "user-42", source_module: "NetworkManager", platform: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 5 * 60000) },
    { session_id: session1, level: "error", message: "Failed to load profile image: 404", screen_name: "ProfileScreen", user_id: "user-42", source_module: "ImageLoader", platform: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 4 * 60000) },
    { session_id: session1, level: "tracking", message: "onboarding.tutorial_begin", screen_name: "OnboardingScreen", user_id: "user-42", source_module: "FunnelTracker", platform: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 3 * 60000) },
    { session_id: session1, level: "attention", message: "User skipped onboarding step 3", screen_name: "OnboardingScreen", user_id: "user-42", source_module: "OnboardingVC", platform: "ios", os_version: "18.3", app_version: "1.0.0", device_model: "iPhone 16", locale: "en_US", timestamp: new Date(now - 2 * 60000), custom_attributes: { step: "3", reason: "skipped" } },
    { session_id: session2, level: "info", message: "App launched", screen_name: "HomeScreen", user_id: "user-99", source_module: "AppDelegate", platform: "ios", os_version: "18.2", app_version: "1.0.0", device_model: "iPhone 15 Pro", locale: "en_US", timestamp: new Date(now - 90000) },
    { session_id: session2, level: "info", message: "Search performed", screen_name: "SearchScreen", user_id: "user-99", source_module: "SearchVC", platform: "ios", os_version: "18.2", app_version: "1.0.0", device_model: "iPhone 15 Pro", locale: "en_US", timestamp: new Date(now - 60000), custom_attributes: { query: "weather", results_count: "12" } },
    { session_id: session2, level: "error", message: "Crash in search results rendering", screen_name: "SearchScreen", user_id: "user-99", source_module: "SearchResultsVC", platform: "ios", os_version: "18.2", app_version: "1.0.0", device_model: "iPhone 15 Pro", locale: "en_US", timestamp: new Date(now - 30000) },
  ];

  await db.insert(events).values(
    seedEvents.map((e) => ({ ...e, app_id: app.id }))
  );

  console.log("\nSeed complete!");
  console.log(`User:       admin@owlmetry.com / H00tH00t`);
  console.log(`Team:       ${team.name} (${team.slug})`);
  console.log(`Project:    ${project.name} (${project.slug})`);
  console.log(`App:        ${app.name} (${app.id})`);
  console.log(`Client Key: ${clientKey}`);
  console.log(`Agent Key:  ${agentKey}`);
  console.log(`Events:     ${seedEvents.length} demo events seeded`);
  console.log("\nSave these keys — they won't be shown again.");

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
