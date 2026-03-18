import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

// Enums
export const teamRoleEnum = pgEnum("team_role", ["owner", "admin", "member"]);
export const apiKeyTypeEnum = pgEnum("api_key_type", ["client", "agent", "server"]);
export const appPlatformEnum = pgEnum("app_platform", ["apple", "android", "web", "backend"]);
export const environmentEnum = pgEnum("environment", ["ios", "ipados", "macos", "android", "web", "backend"]);
export const logLevelEnum = pgEnum("log_level", [
  "info",
  "debug",
  "warn",
  "error",
  "attention",
]);

export const metricStatusEnum = pgEnum("metric_status", ["active", "paused"]);
export const metricPhaseEnum = pgEnum("metric_phase", ["start", "complete", "fail", "cancel", "record"]);

// Users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Email Verification Codes
export const emailVerificationCodes = pgTable(
  "email_verification_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    code_hash: text("code_hash").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    used_at: timestamp("used_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("email_verification_codes_email_idx").on(table.email)]
);

// Teams
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Team members
export const teamMembers = pgTable(
  "team_members",
  {
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull().default("member"),
    joined_at: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("team_members_team_user_idx").on(table.team_id, table.user_id),
    index("team_members_user_id_idx").on(table.user_id),
  ]
);

// Projects
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("projects_team_id_idx").on(table.team_id),
    uniqueIndex("projects_team_slug_idx").on(table.team_id, table.slug),
  ]
);

// Apps
export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    platform: appPlatformEnum("platform").notNull(),
    bundle_id: varchar("bundle_id", { length: 255 }),
    client_key: text("client_key"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("apps_team_id_idx").on(table.team_id),
    index("apps_project_id_idx").on(table.project_id),
  ]
);

// API Keys
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key_hash: text("key_hash").notNull(),
    key_prefix: varchar("key_prefix", { length: 20 }).notNull(),
    key_type: apiKeyTypeEnum("key_type").notNull(),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("api_keys_key_prefix_idx").on(table.key_prefix),
    index("api_keys_team_id_idx").on(table.team_id),
  ]
);

// Events — NOTE: This table is partitioned by month on `timestamp`.
// Drizzle doesn't natively support partitioning, so the migration SQL
// must be manually edited to use PARTITION BY RANGE (timestamp).
// See src/migrate.ts for partition creation logic.
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom(),
    app_id: uuid("app_id").notNull(),
    client_event_id: varchar("client_event_id", { length: 255 }),
    session_id: uuid("session_id").notNull(),
    user_id: varchar("user_id", { length: 255 }),
    level: logLevelEnum("level").notNull(),
    source_module: text("source_module"),
    message: text("message").notNull(),
    screen_name: varchar("screen_name", { length: 255 }),
    custom_attributes: jsonb("custom_attributes").$type<Record<string, string>>(),
    environment: environmentEnum("environment"),
    os_version: varchar("os_version", { length: 50 }),
    app_version: varchar("app_version", { length: 50 }),
    device_model: varchar("device_model", { length: 100 }),
    build_number: varchar("build_number", { length: 50 }),
    locale: varchar("locale", { length: 20 }),
    is_debug: boolean("is_debug").notNull().default(false),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    received_at: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("events_app_timestamp_idx").on(table.app_id, table.timestamp),
    index("events_app_level_timestamp_idx").on(
      table.app_id,
      table.level,
      table.timestamp
    ),
    index("events_app_user_timestamp_idx").on(
      table.app_id,
      table.user_id,
      table.timestamp
    ),
    index("events_app_screen_name_timestamp_idx").on(
      table.app_id,
      table.screen_name,
      table.timestamp
    ),
    index("events_client_event_id_idx").on(table.app_id, table.client_event_id),
    index("events_app_session_timestamp_idx").on(table.app_id, table.session_id, table.timestamp),
    index("events_app_debug_timestamp_idx").on(table.app_id, table.is_debug, table.timestamp),
  ]
);

// App Users — auto-populated on ingest, tracks anonymous vs real users
export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    app_id: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    is_anonymous: boolean("is_anonymous").notNull(),
    claimed_from: jsonb("claimed_from").$type<string[]>(),
    first_seen_at: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("app_users_app_user_idx").on(table.app_id, table.user_id),
    index("app_users_app_anonymous_idx").on(table.app_id, table.is_anonymous),
    index("app_users_app_last_seen_idx").on(table.app_id, table.last_seen_at),
  ]
);

// Funnel Definitions
export const funnelDefinitions = pgTable(
  "funnel_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    app_id: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    steps: jsonb("steps")
      .$type<Array<{ name: string; event_message: string; event_screen_name?: string }>>()
      .notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("funnel_definitions_app_id_idx").on(table.app_id)]
);

// Metric Definitions
export const metricDefinitions = pgTable(
  "metric_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    documentation: text("documentation"),
    schema_definition: jsonb("schema_definition"),
    aggregation_rules: jsonb("aggregation_rules"),
    status: metricStatusEnum("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("metric_definitions_project_id_idx").on(table.project_id),
    uniqueIndex("metric_definitions_project_slug_idx").on(table.project_id, table.slug),
  ]
);

// Metric Events — NOTE: This table is partitioned by month on `timestamp`.
// Same strategy as events table. See src/migrate.ts for partition creation logic.
export const metricEvents = pgTable(
  "metric_events",
  {
    id: uuid("id").defaultRandom(),
    app_id: uuid("app_id").notNull(),
    session_id: uuid("session_id").notNull(),
    user_id: varchar("user_id", { length: 255 }),
    metric_slug: varchar("metric_slug", { length: 255 }).notNull(),
    phase: metricPhaseEnum("phase").notNull(),
    tracking_id: uuid("tracking_id"),
    duration_ms: integer("duration_ms"),
    error: text("error"),
    attributes: jsonb("attributes").$type<Record<string, string>>(),
    environment: environmentEnum("environment"),
    os_version: varchar("os_version", { length: 50 }),
    app_version: varchar("app_version", { length: 50 }),
    device_model: varchar("device_model", { length: 100 }),
    build_number: varchar("build_number", { length: 50 }),
    is_debug: boolean("is_debug").notNull().default(false),
    client_event_id: uuid("client_event_id"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    received_at: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("metric_events_app_slug_timestamp_idx").on(table.app_id, table.metric_slug, table.timestamp),
    index("metric_events_app_slug_phase_timestamp_idx").on(table.app_id, table.metric_slug, table.phase, table.timestamp),
    index("metric_events_app_tracking_id_idx").on(table.app_id, table.tracking_id),
    index("metric_events_app_client_event_id_idx").on(table.app_id, table.client_event_id),
  ]
);

// Funnel Progress
export const funnelProgress = pgTable(
  "funnel_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    funnel_id: uuid("funnel_id")
      .notNull()
      .references(() => funnelDefinitions.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    completed_step_name: text("completed_step_name").notNull(),
    triggering_event_id: uuid("triggering_event_id"),
    completed_at: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("funnel_progress_funnel_user_idx").on(
      table.funnel_id,
      table.user_id
    ),
  ]
);
