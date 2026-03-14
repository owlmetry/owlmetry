export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"],
  maxDatabaseSizeGb: Number(process.env.MAX_DATABASE_SIZE_GB || 0),
  cookieSecure: process.env.NODE_ENV === "production",
};
