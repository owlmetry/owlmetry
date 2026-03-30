import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export * from "./partitions.js";
export * from "./cleanup.js";
export * from "./retention.js";
export { schema };

export function createDatabaseConnection(databaseUrl: string) {
  const client = postgres(databaseUrl);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDatabaseConnection>;
