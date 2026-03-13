import { sql } from "drizzle-orm";
import { createDatabaseConnection } from "./index.js";

const url = "postgres://localhost:5432/owlmetry";

async function main() {
  const db = createDatabaseConnection(url);

  console.log("Clearing all data...");

  // Truncate each table individually, skipping any that don't exist yet
  const tables = [
    "funnel_progress",
    "funnel_definitions",
    "event_identity_claims",
    "api_keys",
    "apps",
    "projects",
    "team_members",
    "teams",
    "users",
    "events",
  ];

  for (const table of tables) {
    await db.execute(sql.raw(`TRUNCATE ${table} CASCADE`)).catch(() => {});
  }

  console.log("Done — all tables cleared. Run `pnpm db:seed` to re-seed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Clear failed:", err);
  process.exit(1);
});
