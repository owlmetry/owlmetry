import { createDb } from "./index.js";
import { users, teams, teamMembers, apps, apiKeys } from "./schema.js";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import "dotenv/config";

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function main() {
  const db = createDb(url);

  console.log("Seeding database...");

  // Create default user
  const [user] = await db
    .insert(users)
    .values({
      email: "admin@owlmetry.dev",
      password_hash: await bcrypt.hash("admin123", 12),
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

  // Create a demo app
  const [app] = await db
    .insert(apps)
    .values({
      team_id: team.id,
      name: "Demo App",
      platform: "ios",
      bundle_id: "dev.owlmetry.demo",
    })
    .returning();

  // Create client API key
  const clientKey = `owl_client_${randomBytes(24).toString("hex")}`;
  await db.insert(apiKeys).values({
    key_hash: hashKey(clientKey),
    key_prefix: clientKey.slice(0, 16),
    key_type: "client",
    app_id: app.id,
    team_id: team.id,
    name: "Demo Client Key",
    permissions: ["events:write"],
  });

  // Create agent API key
  const agentKey = `owl_agent_${randomBytes(24).toString("hex")}`;
  await db.insert(apiKeys).values({
    key_hash: hashKey(agentKey),
    key_prefix: agentKey.slice(0, 16),
    key_type: "agent",
    app_id: null,
    team_id: team.id,
    name: "Demo Agent Key",
    permissions: ["events:read", "funnels:read"],
  });

  console.log("\nSeed complete!");
  console.log(`User:       admin@owlmetry.dev / admin123`);
  console.log(`Team:       ${team.name} (${team.slug})`);
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
