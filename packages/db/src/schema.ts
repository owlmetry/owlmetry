import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

// Enums
export const teamRoleEnum = pgEnum("team_role", ["owner", "admin", "member"]);
export const apiKeyTypeEnum = pgEnum("api_key_type", ["client", "agent"]);
export const logLevelEnum = pgEnum("log_level", [
  "info",
  "debug",
  "warn",
  "error",
  "attention",
  "tracking",
]);

// Users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password_hash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Teams
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  },
  (table) => [
    uniqueIndex("team_members_team_user_idx").on(table.team_id, table.user_id),
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
    name: varchar("name", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 50 }).notNull(),
    bundle_id: varchar("bundle_id", { length: 255 }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("apps_team_id_idx").on(table.team_id)]
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
    user_id: varchar("user_id", { length: 255 }),
    level: logLevelEnum("level").notNull(),
    source_module: text("source_module"),
    message: text("message").notNull(),
    screen_name: varchar("screen_name", { length: 255 }),
    custom_attributes: jsonb("custom_attributes").$type<Record<string, string>>(),
    platform: varchar("platform", { length: 20 }),
    os_version: varchar("os_version", { length: 50 }),
    app_version: varchar("app_version", { length: 50 }),
    device_model: varchar("device_model", { length: 100 }),
    build_number: varchar("build_number", { length: 50 }),
    locale: varchar("locale", { length: 20 }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    received_at: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    is_resolved: boolean("is_resolved").notNull().default(false),
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
  ]
);

// Event Identity Claims
export const eventIdentityClaims = pgTable(
  "event_identity_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    app_id: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    anonymous_id: varchar("anonymous_id", { length: 255 }).notNull(),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    events_reassigned_count: integer("events_reassigned_count").notNull().default(0),
    claimed_at: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("event_identity_claims_app_anon_idx").on(
      table.app_id,
      table.anonymous_id
    ),
    index("event_identity_claims_app_user_idx").on(table.app_id, table.user_id),
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
  },
  (table) => [index("funnel_definitions_app_id_idx").on(table.app_id)]
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
