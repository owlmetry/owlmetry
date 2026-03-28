import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

// Load .env from monorepo root before reading env vars
dotenvConfig({ path: resolve(import.meta.dirname, "../../../.env") });

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL || "postgresql://localhost:5432/owlmetry",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"],
  maxDatabaseSizeGb: Number(process.env.MAX_DATABASE_SIZE_GB || 0),
  cookieSecure: process.env.NODE_ENV === "production",
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "noreply@owlmetry.com",
  webAppUrl: process.env.WEB_APP_URL || "http://localhost:3000",
  systemJobsAlertEmail: process.env.SYSTEM_JOBS_ALERT_EMAIL || "",
};
