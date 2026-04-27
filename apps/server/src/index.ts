import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { createDatabaseConnection } from "@owlmetry/db";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { ingestRoutes } from "./routes/ingest.js";
import { feedbackIngestRoutes } from "./routes/feedback-ingest.js";
import { ingestAttachmentRoutes } from "./routes/ingest-attachment.js";
import { attachmentsRoutes } from "./routes/attachments.js";
import { importRoutes } from "./routes/import.js";
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
import { attributionRoutes } from "./routes/attribution.js";
import { integrationsRoutes } from "./routes/integrations.js";
import { revenuecatRoutes } from "./routes/revenuecat.js";
import { appleSearchAdsRoutes } from "./routes/apple-search-ads.js";
import { appStoreConnectRoutes } from "./routes/app-store-connect.js";
import { jobsRoutes, jobsByIdRoutes } from "./routes/jobs.js";
import { issuesRoutes, teamIssuesRoutes } from "./routes/issues.js";
import { feedbackRoutes, teamFeedbackRoutes } from "./routes/feedback.js";
import { reviewsRoutes, teamReviewsRoutes } from "./routes/reviews.js";
import { ratingsRoutes, teamRatingsRoutes } from "./routes/ratings.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { devicesRoutes } from "./routes/devices.js";
import { mcpRoute } from "./mcp/index.js";
import { decompressPlugin } from "./middleware/decompress.js";
import { createEmailService } from "./services/email.js";
import { JobRunner } from "./services/job-runner.js";
import { registerAllJobs } from "./jobs/index.js";
import { NotificationDispatcher } from "./services/notifications/dispatcher.js";
import { inAppAdapter } from "./services/notifications/adapters/in-app.js";
import { createEmailAdapter } from "./services/notifications/adapters/email.js";
import { createIosPushAdapter } from "./services/notifications/adapters/ios-push.js";
import { ApnsClient } from "./utils/apns/client.js";
import type { ChannelAdapter } from "./services/notifications/types.js";

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

// Notification dispatcher — drops in iOS push adapter only when APNS_* env vars are set.
// Two APNs clients side-by-side: each owns its own HTTP/2 session, adapter routes
// per device.environment. Same auth key works for both hosts.
const adapters: ChannelAdapter[] = [inAppAdapter, createEmailAdapter(emailService)];
const apnsClients = config.apns
  ? {
      sandbox: new ApnsClient(config.apns, "https://api.sandbox.push.apple.com"),
      production: new ApnsClient(config.apns, "https://api.push.apple.com"),
    }
  : null;
if (apnsClients && config.apns) {
  adapters.push(createIosPushAdapter(apnsClients));
  app.log.info(`APNs configured for ${config.apns.bundleId} — per-device sandbox/production routing`);
} else {
  app.log.info("APNs not configured (APNS_KEY_P8 unset) — iOS push deliveries will be skipped");
}

const notificationDispatcher = new NotificationDispatcher({
  db,
  jobRunner,
  log: app.log,
  adapters,
});
jobRunner.setNotificationDispatcher(notificationDispatcher);

registerAllJobs(jobRunner, notificationDispatcher);

const isDev = process.env.NODE_ENV !== "production";

jobRunner.schedule({
  jobType: "partition_creation",
  cron: isDev ? "*/5 * * * *" : "0 4 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "db_pruning",
  cron: isDev ? "* * * * *" : "0 * * * *",
  enabled: () => config.maxDatabaseSizeGb > 0,
  params: () => ({ max_size_bytes: config.maxDatabaseSizeGb * 1024 * 1024 * 1024 }),
});
jobRunner.schedule({
  jobType: "retention_cleanup",
  cron: isDev ? "*/5 * * * *" : "0 2 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "soft_delete_cleanup",
  cron: isDev ? "*/5 * * * *" : "0 3 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "issue_scan",
  cron: isDev ? "*/5 * * * *" : "0 * * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "issue_notify",
  cron: isDev ? "*/5 * * * *" : "5 * * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "attachment_cleanup",
  cron: isDev ? "*/5 * * * *" : "0 5 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "app_version_sync",
  cron: isDev ? "*/5 * * * *" : "15 * * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "app_store_ratings_sync",
  // Daily 04:30 UTC in prod (between 04:00 partition_creation and 05:00
  // attachment_cleanup). Dev runs every 30 min so iteration is observable.
  cron: isDev ? "*/30 * * * *" : "30 4 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "notification_cleanup",
  cron: isDev ? "*/10 * * * *" : "0 6 * * *",
  enabled: () => true,
  params: () => ({}),
});

// Decorators
app.decorate("db", db);
app.decorate("databaseUrl", config.databaseUrl);
app.decorate("emailService", emailService);
app.decorate("jobRunner", jobRunner);
app.decorate("notificationDispatcher", notificationDispatcher);

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
await app.register(feedbackIngestRoutes, { prefix: "/v1" });
await app.register(ingestAttachmentRoutes, { prefix: "/v1" });
await app.register(attachmentsRoutes, { prefix: "/v1" });
await app.register(importRoutes, { prefix: "/v1" });
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
await app.register(attributionRoutes, { prefix: "/v1" });
await app.register(integrationsRoutes, { prefix: "/v1/projects/:projectId" });
await app.register(revenuecatRoutes, { prefix: "/v1" });
await app.register(appleSearchAdsRoutes, { prefix: "/v1" });
await app.register(appStoreConnectRoutes, { prefix: "/v1" });
await app.register(jobsRoutes, { prefix: "/v1/teams/:teamId" });
await app.register(jobsByIdRoutes, { prefix: "/v1" });
await app.register(issuesRoutes, { prefix: "/v1/projects/:projectId" });
await app.register(teamIssuesRoutes, { prefix: "/v1" });
await app.register(feedbackRoutes, { prefix: "/v1/projects/:projectId" });
await app.register(teamFeedbackRoutes, { prefix: "/v1" });
await app.register(reviewsRoutes, { prefix: "/v1/projects/:projectId" });
await app.register(teamReviewsRoutes, { prefix: "/v1" });
await app.register(ratingsRoutes, { prefix: "/v1/projects/:projectId" });
await app.register(teamRatingsRoutes, { prefix: "/v1" });
await app.register(notificationsRoutes, { prefix: "/v1" });
await app.register(devicesRoutes, { prefix: "/v1" });
await app.register(mcpRoute);

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
  apnsClients?.sandbox.close();
  apnsClients?.production.close();
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
