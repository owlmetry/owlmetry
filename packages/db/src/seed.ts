import { createDatabaseConnection } from "./index.js";
import { users, teams, teamMembers, projects, apps, apiKeys } from "./schema.js";
import { hashApiKey, KEY_PREFIX_LENGTH } from "@owlmetry/shared";
import bcrypt from "bcrypt";
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

  console.log("\nSeed complete!");
  console.log(`User:       admin@owlmetry.com / H00tH00t`);
  console.log(`Team:       ${team.name} (${team.slug})`);
  console.log(`Project:    ${project.name} (${project.slug})`);
  console.log(`App:        ${app.name} (${app.id})`);
  console.log(`Client Key: ${clientKey}`);
  console.log(`Agent Key:  ${agentKey}`);
  console.log("\nSave these keys — they won't be shown again.");

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
