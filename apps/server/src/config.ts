import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

// Load .env from monorepo root before reading env vars
dotenvConfig({ path: resolve(import.meta.dirname, "../../../.env") });

const isProduction = process.env.NODE_ENV === "production";

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL || "postgresql://localhost:5432/owlmetry",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"],
  maxDatabaseSizeGb: Number(process.env.MAX_DATABASE_SIZE_GB || 0),
  cookieSecure: isProduction,
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "noreply@owlmetry.com",
  webAppUrl: process.env.WEB_APP_URL || "http://localhost:3000",
  systemJobsAlertEmail: process.env.SYSTEM_JOBS_ALERT_EMAIL || "",
  publicUrl: process.env.API_PUBLIC_URL || "https://api.owlmetry.com",
  // Attachment storage — files live on the local filesystem, metadata lives in Postgres.
  // In production, point this at a dedicated mount so disk-full on attachments does not
  // starve Postgres. Do NOT include this path in pg_dump backups.
  attachmentsPath:
    process.env.OWLMETRY_ATTACHMENTS_PATH ||
    (isProduction ? "/opt/owlmetry-attachments" : "./data/attachments"),
  // HMAC secret for signed download URLs. Falls back to jwtSecret in dev; in prod, set
  // OWLMETRY_ATTACHMENTS_SIGNING_SECRET explicitly.
  attachmentsSigningSecret:
    process.env.OWLMETRY_ATTACHMENTS_SIGNING_SECRET ||
    process.env.JWT_SECRET ||
    "dev-secret-change-me",
  // When set, the server responds to download requests with an X-Accel-Redirect header
  // pointing at this nginx `internal` location (mapped to attachmentsPath). Leave empty
  // in dev — the server will then stream bytes directly.
  attachmentsInternalUri: process.env.OWLMETRY_ATTACHMENTS_INTERNAL_URI || "",
};
