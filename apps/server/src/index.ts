import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import postgres from "postgres";
import { createDatabaseConnection, ensurePartitions, dropOldestEventPartitions } from "@owlmetry/db";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { ingestRoutes } from "./routes/ingest.js";
import { eventsRoutes } from "./routes/events.js";
import { appsRoutes } from "./routes/apps.js";
import { projectsRoutes } from "./routes/projects.js";
import { identityRoutes } from "./routes/identity.js";
import { teamsRoutes } from "./routes/teams.js";
import { decompressPlugin } from "./middleware/decompress.js";

const app = Fastify({ logger: true });

// Database
const db = createDatabaseConnection(config.databaseUrl);

// Ensure event partitions exist (current month + next 2)
try {
  const partitionClient = postgres(config.databaseUrl, { max: 1 });
  await ensurePartitions(partitionClient, 3);
  await partitionClient.end();
} catch (err) {
  app.log.warn("Failed to ensure partitions on startup — partitions may need manual creation");
  app.log.warn(err);
}

// Decorators
app.decorate("db", db);

// Plugins
await app.register(decompressPlugin);
await app.register(cookie);
await app.register(cors, { origin: config.corsOrigins, credentials: true });
await app.register(jwt, { secret: config.jwtSecret });

// Health check
app.get("/health", async () => ({ status: "ok" }));

// Routes
await app.register(authRoutes, { prefix: "/v1/auth" });
await app.register(ingestRoutes, { prefix: "/v1" });
await app.register(eventsRoutes, { prefix: "/v1" });
await app.register(appsRoutes, { prefix: "/v1" });
await app.register(projectsRoutes, { prefix: "/v1" });
await app.register(identityRoutes, { prefix: "/v1" });
await app.register(teamsRoutes, { prefix: "/v1" });

// Start
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Server running on ${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Database size pruning (runs after server is listening)
let pruningInterval: ReturnType<typeof setInterval> | undefined;

if (config.maxDatabaseSizeGb > 0) {
  const maxSizeBytes = config.maxDatabaseSizeGb * 1024 * 1024 * 1024;

  const runPruning = async () => {
    const client = postgres(config.databaseUrl, { max: 1 });
    try {
      const result = await dropOldestEventPartitions(client, maxSizeBytes);
      if (result.droppedPartitions.length > 0 || result.deletedRows > 0) {
        app.log.info(
          `Database pruning: dropped partitions [${result.droppedPartitions.join(", ")}], ` +
            `deleted ${result.deletedRows} rows. ` +
            `Current size: ${(result.currentSizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
        );
      }
    } catch (err) {
      app.log.error("Database size pruning failed:");
      app.log.error(err);
    } finally {
      await client.end();
    }
  };

  runPruning();
  pruningInterval = setInterval(runPruning, 3_600_000);
}

// Graceful shutdown
const shutdown = async () => {
  if (pruningInterval) clearInterval(pruningInterval);
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
