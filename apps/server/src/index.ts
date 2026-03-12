import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import postgres from "postgres";
import { createDb, ensurePartitions } from "@owlmetry/db";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { ingestRoutes } from "./routes/ingest.js";
import { eventsRoutes } from "./routes/events.js";
import { appsRoutes } from "./routes/apps.js";
import { identityRoutes } from "./routes/identity.js";
import { decompressPlugin } from "./middleware/decompress.js";

const app = Fastify({ logger: true });

// Database
const db = createDb(config.databaseUrl);

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
await app.register(cors, { origin: config.corsOrigins });
await app.register(jwt, { secret: config.jwtSecret });

// Health check
app.get("/health", async () => ({ status: "ok" }));

// Routes
await app.register(authRoutes, { prefix: "/v1/auth" });
await app.register(ingestRoutes, { prefix: "/v1" });
await app.register(eventsRoutes, { prefix: "/v1" });
await app.register(appsRoutes, { prefix: "/v1" });
await app.register(identityRoutes, { prefix: "/v1" });

// Start
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Server running on ${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
