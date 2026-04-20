import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

dotenvConfig({ path: resolve(import.meta.dirname, "../../../.env") });

const isProduction = process.env.NODE_ENV === "production";

function resolveAttachmentsSigningSecret(): string {
  const explicit = process.env.OWLMETRY_ATTACHMENTS_SIGNING_SECRET;
  if (explicit) return explicit;
  if (isProduction) {
    throw new Error(
      "OWLMETRY_ATTACHMENTS_SIGNING_SECRET must be set in production. " +
        "Generate with `openssl rand -hex 32` and add it to your environment " +
        "(pm2 ecosystem config or systemd unit). It must NOT be the same as JWT_SECRET."
    );
  }
  return process.env.JWT_SECRET || "dev-secret-change-me";
}

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
  attachmentsPath:
    process.env.OWLMETRY_ATTACHMENTS_PATH ||
    (isProduction ? "/opt/owlmetry-attachments" : "./data/attachments"),
  attachmentsSigningSecret: resolveAttachmentsSigningSecret(),
  attachmentsInternalUri: process.env.OWLMETRY_ATTACHMENTS_INTERNAL_URI || "",
};
