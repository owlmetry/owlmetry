import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import postgres from "postgres";
import { createDatabaseConnection, ensurePartitions, ensureMetricEventPartitions, ensureFunnelEventPartitions, dropOldestEventPartitions, cleanupSoftDeletedResources } from "@owlmetry/db";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { ingestRoutes } from "./routes/ingest.js";
import { eventsRoutes } from "./routes/events.js";
import { appsRoutes } from "./routes/apps.js";
import { projectsRoutes } from "./routes/projects.js";
import { identityRoutes } from "./routes/identity.js";
import { appUsersRoutes } from "./routes/app-users.js";
import { teamsRoutes } from "./routes/teams.js";
import { invitationRoutes } from "./routes/invitations.js";
import { metricsRoutes, metricByIdRoutes } from "./routes/metrics.js";
import { funnelsRoutes, funnelByIdRoutes } from "./routes/funnels.js";
import { auditLogsRoutes } from "./routes/audit-logs.js";
import { userPropertiesRoutes } from "./routes/user-properties.js";
import { integrationsRoutes } from "./routes/integrations.js";
import { revenuecatRoutes } from "./routes/revenuecat.js";
import { decompressPlugin } from "./middleware/decompress.js";
import { createEmailService } from "./services/email.js";

const app = Fastify({ logger: true });

// Database
const db = createDatabaseConnection(config.databaseUrl);

// Ensure event partitions exist (current month + next 2)
try {
  const partitionClient = postgres(config.databaseUrl, { max: 1 });
  await ensurePartitions(partitionClient, 3);
  await ensureMetricEventPartitions(partitionClient, 3);
  await ensureFunnelEventPartitions(partitionClient, 3);
  await partitionClient.end();
} catch (err) {
  app.log.warn("Failed to ensure partitions on startup — partitions may need manual creation");
  app.log.warn(err);
}

// Decorators
app.decorate("db", db);
app.decorate("emailService", createEmailService(config.resendApiKey, config.emailFrom));

// Plugins
await app.register(decompressPlugin);
await app.register(cookie);
await app.register(cors, {
  origin: config.corsOrigins,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
});
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
await app.register(appUsersRoutes, { prefix: "/v1" });
await app.register(teamsRoutes, { prefix: "/v1" });
await app.register(invitationRoutes, { prefix: "/v1" });
await app.register(metricsRoutes, { prefix: "/v1/projects/:projectId" });
await app.register(metricByIdRoutes, { prefix: "/v1" });
await app.register(funnelsRoutes, { prefix: "/v1/projects/:projectId" });
await app.register(funnelByIdRoutes, { prefix: "/v1" });
await app.register(auditLogsRoutes, { prefix: "/v1/teams/:teamId" });
await app.register(userPropertiesRoutes, { prefix: "/v1" });
await app.register(integrationsRoutes, { prefix: "/v1/projects/:projectId" });
await app.register(revenuecatRoutes, { prefix: "/v1" });

// Start
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Server running on ${config.host}:${config.port}`);
} catch (err: any) {
  if (err?.code === "EADDRINUSE") {
    console.error(`\nPort ${config.port} is already in use. Kill the existing process:\n  lsof -ti:${config.port} | xargs kill\n`);
  } else {
    app.log.error(err);
  }
  // Kill the parent process (tsx watch) so it doesn't restart in a loop
  if (process.ppid) process.kill(process.ppid, "SIGTERM");
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

// Soft-delete cleanup (runs daily, hard-deletes resources soft-deleted > 7 days ago)
let cleanupInterval: ReturnType<typeof setInterval> | undefined;

const runCleanup = async () => {
  const client = postgres(config.databaseUrl, { max: 1 });
  try {
    const result = await cleanupSoftDeletedResources(client);
    const total = Object.values(result).reduce((a, b) => a + b, 0);
    if (total > 0) {
      app.log.info(
        `Soft-delete cleanup: ${JSON.stringify(result)}`
      );
    }
  } catch (err) {
    app.log.error("Soft-delete cleanup failed:");
    app.log.error(err);
  } finally {
    await client.end();
  }
};

runCleanup();
cleanupInterval = setInterval(runCleanup, 86_400_000); // 24 hours

// Graceful shutdown
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;

  // Force-exit if graceful shutdown takes too long (e.g. tsx watch killing us)
  const forceTimer = setTimeout(() => process.exit(0), 3000);
  forceTimer.unref();

  if (pruningInterval) clearInterval(pruningInterval);
  if (cleanupInterval) clearInterval(cleanupInterval);
  try {
    await app.close();
  } catch {
    // Ignore close errors during shutdown
  }
  clearTimeout(forceTimer);
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
