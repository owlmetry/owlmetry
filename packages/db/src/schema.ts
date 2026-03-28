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
]);

export const metricPhaseEnum = pgEnum("metric_phase", ["start", "complete", "fail", "cancel", "record"]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "completed", "failed", "cancelled"]);

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
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
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
    created_by: uuid("created_by").notNull().references(() => users.id),
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
    client_event_id: uuid("client_event_id"),
    session_id: uuid("session_id").notNull(),
    user_id: varchar("user_id", { length: 255 }),
    api_key_id: uuid("api_key_id"),
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
    is_dev: boolean("is_dev").notNull().default(false),
    experiments: jsonb("experiments").$type<Record<string, string>>(),
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
    index("events_app_dev_timestamp_idx").on(table.app_id, table.is_dev, table.timestamp),
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
    properties: jsonb("properties").$type<Record<string, string>>(),
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

// Team Invitations
export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: teamRoleEnum("role").notNull().default("member"),
    token: uuid("token").notNull().defaultRandom(),
    invited_by_user_id: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("team_invitations_team_email_idx").on(table.team_id, table.email),
    uniqueIndex("team_invitations_token_idx").on(table.token),
    index("team_invitations_email_idx").on(table.email),
  ]
);

// Funnel Definitions
export const funnelDefinitions = pgTable(
  "funnel_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    steps: jsonb("steps")
      .$type<Array<{ name: string; event_filter: { step_name?: string; screen_name?: string } }>>()
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
  (table) => [
    index("funnel_definitions_project_id_idx").on(table.project_id),
    uniqueIndex("funnel_definitions_project_slug_idx").on(table.project_id, table.slug),
  ]
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
    api_key_id: uuid("api_key_id"),
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
    is_dev: boolean("is_dev").notNull().default(false),
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

// Audit Logs
export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "api_key", "system"]);
export const auditActionEnum = pgEnum("audit_action", ["create", "update", "delete"]);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    actor_type: auditActorTypeEnum("actor_type").notNull(),
    actor_id: varchar("actor_id", { length: 255 }).notNull(),
    action: auditActionEnum("action").notNull(),
    resource_type: varchar("resource_type", { length: 50 }).notNull(),
    resource_id: varchar("resource_id", { length: 255 }).notNull(),
    changes: jsonb("changes").$type<Record<string, { before?: unknown; after?: unknown }>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_team_timestamp_idx").on(table.team_id, table.timestamp),
    index("audit_logs_resource_idx").on(table.resource_type, table.resource_id),
    index("audit_logs_actor_idx").on(table.actor_type, table.actor_id),
  ]
);

// Funnel Events — NOTE: This table is partitioned by month on `timestamp`.
// Same strategy as events and metric_events tables. See src/migrate.ts for partition creation logic.
export const funnelEvents = pgTable(
  "funnel_events",
  {
    id: uuid("id").defaultRandom(),
    app_id: uuid("app_id").notNull(),
    session_id: uuid("session_id").notNull(),
    user_id: varchar("user_id", { length: 255 }),
    api_key_id: uuid("api_key_id"),
    step_name: varchar("step_name", { length: 255 }).notNull(),
    message: text("message").notNull(),
    screen_name: varchar("screen_name", { length: 255 }),
    custom_attributes: jsonb("custom_attributes").$type<Record<string, string>>(),
    experiments: jsonb("experiments").$type<Record<string, string>>(),
    environment: environmentEnum("environment"),
    os_version: varchar("os_version", { length: 50 }),
    app_version: varchar("app_version", { length: 50 }),
    device_model: varchar("device_model", { length: 100 }),
    build_number: varchar("build_number", { length: 50 }),
    is_dev: boolean("is_dev").notNull().default(false),
    client_event_id: uuid("client_event_id"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    received_at: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("funnel_events_app_step_timestamp_idx").on(table.app_id, table.step_name, table.timestamp),
    index("funnel_events_app_user_timestamp_idx").on(table.app_id, table.user_id, table.timestamp),
    index("funnel_events_app_step_user_timestamp_idx").on(table.app_id, table.step_name, table.user_id, table.timestamp),
    index("funnel_events_app_client_event_id_idx").on(table.app_id, table.client_event_id),
  ]
);

// Project Integrations — per-project third-party service configs (e.g. RevenueCat)
export const projectIntegrations = pgTable(
  "project_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
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
    uniqueIndex("project_integrations_project_provider_idx").on(table.project_id, table.provider),
    index("project_integrations_project_id_idx").on(table.project_id),
  ]
);

// Background job runs
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job_type: varchar("job_type", { length: 100 }).notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    team_id: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    triggered_by: varchar("triggered_by", { length: 100 }).notNull(),
    params: jsonb("params").$type<Record<string, unknown>>(),
    progress: jsonb("progress").$type<{
      processed: number;
      total: number;
      message?: string;
    }>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    notify: boolean("notify").notNull().default(false),
    started_at: timestamp("started_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("job_runs_job_type_created_at_idx").on(table.job_type, table.created_at),
    index("job_runs_status_idx").on(table.status),
    index("job_runs_team_id_created_at_idx").on(table.team_id, table.created_at),
    index("job_runs_project_id_idx").on(table.project_id),
  ]
);
