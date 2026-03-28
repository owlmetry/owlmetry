import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { createDatabaseConnection } from "@owlmetry/db";
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
import { jobsRoutes, jobsByIdRoutes } from "./routes/jobs.js";
import { decompressPlugin } from "./middleware/decompress.js";
import { createEmailService } from "./services/email.js";
import { JobRunner } from "./services/job-runner.js";
import { registerAllJobs } from "./jobs/index.js";

const app = Fastify({ logger: true });

// Database
const db = createDatabaseConnection(config.databaseUrl);

// Services
const emailService = createEmailService(config.resendApiKey, config.emailFrom);

// Job Runner
const jobRunner = new JobRunner({
  db,
  databaseUrl: config.databaseUrl,
  log: app.log,
  emailService,
  systemJobsAlertEmail: config.systemJobsAlertEmail,
});

registerAllJobs(jobRunner);

jobRunner.schedule({
  jobType: "partition_creation",
  cron: "0 4 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "db_pruning",
  cron: "0 * * * *",
  enabled: () => config.maxDatabaseSizeGb > 0,
  params: () => ({ max_size_bytes: config.maxDatabaseSizeGb * 1024 * 1024 * 1024 }),
});
jobRunner.schedule({
  jobType: "soft_delete_cleanup",
  cron: "0 3 * * *",
  enabled: () => true,
  params: () => ({}),
});

// Decorators
app.decorate("db", db);
app.decorate("emailService", emailService);
app.decorate("jobRunner", jobRunner);

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
await app.register(jobsRoutes, { prefix: "/v1/teams/:teamId" });
await app.register(jobsByIdRoutes, { prefix: "/v1" });

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

// Start scheduled jobs after server is listening
jobRunner.startSchedules().catch((err) => {
  app.log.error(err, "Failed to start job schedules");
});

// Graceful shutdown
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;

  // Force-exit if graceful shutdown takes too long (e.g. tsx watch killing us)
  const forceTimer = setTimeout(() => process.exit(0), 3000);
  forceTimer.unref();

  await jobRunner.shutdown(2500);
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
