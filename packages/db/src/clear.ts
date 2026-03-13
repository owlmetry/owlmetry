import { sql } from "drizzle-orm";
import { createInterface } from "node:readline";
import { createDatabaseConnection } from "./index.js";

const url =
  process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry_test";

function getDatabaseName(connectionUrl: string): string | null {
  try {
    const parsed = new URL(connectionUrl);
    // pathname is "/dbname", strip the leading slash
    return parsed.pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("ABORT: NODE_ENV is 'production'. This script is for local development only.");
    process.exit(1);
  }

  const dbName = getDatabaseName(url);
  if (!dbName || !dbName.endsWith("_test")) {
    console.error(`ABORT: Database "${dbName}" does not end with "_test".`);
    console.error("This script only runs against test databases (e.g. owlmetry_test). Set DATABASE_URL to a _test database.");
    process.exit(1);
  }

  const skipConfirmation = process.argv.includes("--yes");

  if (!skipConfirmation) {
    console.warn("⚠  This will TRUNCATE all tables in the local database.");
    const confirmed = await confirm("Type 'yes' to continue: ");
    if (!confirmed) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

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
