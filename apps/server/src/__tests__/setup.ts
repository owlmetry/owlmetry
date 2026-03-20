import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@owlmetry/db";
import { createDatabaseConnection, ensurePartitions, ensureMetricEventPartitions, ensureFunnelEventPartitions } from "@owlmetry/db";
import { hashApiKey, KEY_PREFIX_LENGTH } from "@owlmetry/shared";
import type { Permission, TeamRole } from "@owlmetry/shared";
import { authRoutes } from "../routes/auth.js";
import { ingestRoutes } from "../routes/ingest.js";
import { eventsRoutes } from "../routes/events.js";
import { appsRoutes } from "../routes/apps.js";
import { projectsRoutes } from "../routes/projects.js";
import { identityRoutes } from "../routes/identity.js";
import { appUsersRoutes } from "../routes/app-users.js";
import { teamsRoutes } from "../routes/teams.js";
import { invitationRoutes } from "../routes/invitations.js";
import { metricsRoutes } from "../routes/metrics.js";
import { funnelsRoutes } from "../routes/funnels.js";
import { auditLogsRoutes } from "../routes/audit-logs.js";
import { decompressPlugin } from "../middleware/decompress.js";
import type { EmailService } from "../services/email.js";

export const TEST_DB_URL = "postgres://localhost:5432/owlmetry_test";

export const TEST_CLIENT_KEY =
  "owl_client_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const TEST_AGENT_KEY =
  "owl_agent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const TEST_EXPIRED_KEY =
  "owl_client_cccccccccccccccccccccccccccccccccccccccccccccc";
export const TEST_BACKEND_CLIENT_KEY =
  "owl_client_dddddddddddddddddddddddddddddddddddddddddddddd";
export const TEST_ANDROID_CLIENT_KEY =
  "owl_client_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const TEST_ANDROID_BUNDLE_ID = "com.owlmetry.test.android";
export const TEST_BUNDLE_ID = "com.owlmetry.test";
export const TEST_SESSION_ID = "00000000-0000-0000-0000-000000000001";
export const TEST_USER = {
  email: "test@owlmetry.com",
  name: "Test User",
};

export class TestEmailService implements EmailService {
  lastCode: string = "";
  lastEmail: string = "";
  lastInvitationEmail: string = "";
  lastInvitationParams: { team_name: string; invited_by_name: string; role: string; accept_url: string } | null = null;

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.lastCode = code;
    this.lastEmail = email;
  }

  async sendTeamInvitation(email: string, params: { team_name: string; invited_by_name: string; role: string; accept_url: string }): Promise<void> {
    this.lastInvitationEmail = email;
    this.lastInvitationParams = params;
  }
}

let migrationClient: postgres.Sql | null = null;

export async function setupTestDb() {
  migrationClient = postgres(TEST_DB_URL, { max: 1 });

  // Add 'server' to api_key_type enum if it exists but doesn't have the value yet.
  // ALTER TYPE ... ADD VALUE cannot run inside a transaction, so we do it before migrate().
  // On a completely fresh DB, the enum won't exist yet — we handle that after migrate().
  const typeExistsBefore = await migrationClient`
    SELECT 1 FROM pg_type WHERE typname = 'api_key_type'
  `;
  if (typeExistsBefore.length > 0) {
    const enumCheck = await migrationClient`
      SELECT 1 FROM pg_enum WHERE enumlabel = 'server'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'api_key_type')
    `;
    if (enumCheck.length === 0) {
      await migrationClient.unsafe(`ALTER TYPE api_key_type ADD VALUE 'server'`);
    }
  }

  // Pre-migration fixes for existing databases only (skip on fresh DB)
  if (typeExistsBefore.length > 0) {
    // Create app_platform and environment enums if not present
    const appPlatformCheck = await migrationClient`
      SELECT 1 FROM pg_type WHERE typname = 'app_platform'
    `;
    if (appPlatformCheck.length === 0) {
      await migrationClient.unsafe(`CREATE TYPE app_platform AS ENUM ('apple', 'android', 'web', 'backend')`);
    }
    const environmentCheck = await migrationClient`
      SELECT 1 FROM pg_type WHERE typname = 'environment'
    `;
    if (environmentCheck.length === 0) {
      await migrationClient.unsafe(`CREATE TYPE environment AS ENUM ('ios', 'ipados', 'macos', 'android', 'web', 'backend')`);
    }

    // Make bundle_id nullable if not already
    const colCheck = await migrationClient`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'apps' AND column_name = 'bundle_id'
    `;
    if (colCheck.length > 0 && colCheck[0].is_nullable === 'NO') {
      await migrationClient`ALTER TABLE apps ALTER COLUMN bundle_id DROP NOT NULL`;
    }

    // Convert apps.platform from varchar to app_platform enum if needed
    const platformColCheck = await migrationClient`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'apps' AND column_name = 'platform'
    `;
    if (platformColCheck.length > 0 && platformColCheck[0].data_type === 'character varying') {
      await migrationClient.unsafe(`
        UPDATE apps SET platform = 'apple' WHERE platform IN ('ios', 'ipados', 'macos');
        UPDATE apps SET platform = 'backend' WHERE platform = 'server';
        ALTER TABLE apps ALTER COLUMN platform TYPE app_platform USING platform::app_platform
      `);
    }
  }

  const migrationDb = drizzle(migrationClient);
  await migrate(migrationDb, {
    migrationsFolder: "../../packages/db/drizzle",
  });

  // After migration, ensure 'server' exists in api_key_type
  const serverEnumCheck = await migrationClient`
    SELECT 1 FROM pg_enum WHERE enumlabel = 'server'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'api_key_type')
  `;
  if (serverEnumCheck.length === 0) {
    await migrationClient.unsafe(`ALTER TYPE api_key_type ADD VALUE 'server'`);
  }

  // Set up partitioned events table
  const result = await migrationClient`
    SELECT relkind FROM pg_class WHERE relname = 'events'
  `;

  if (result.length > 0 && result[0].relkind !== "p") {
    await migrationClient`DROP TABLE IF EXISTS events CASCADE`;
  }

  if (result.length === 0 || result[0].relkind !== "p") {
    await migrationClient.unsafe(`
      CREATE TABLE IF NOT EXISTS events (
        id UUID DEFAULT gen_random_uuid(),
        app_id UUID NOT NULL,
        client_event_id UUID,
        session_id UUID NOT NULL,
        user_id VARCHAR(255),
        api_key_id UUID,
        level log_level NOT NULL,
        source_module TEXT,
        message TEXT NOT NULL,
        screen_name VARCHAR(255),
        custom_attributes JSONB,
        environment environment,
        os_version VARCHAR(50),
        app_version VARCHAR(50),
        device_model VARCHAR(100),
        build_number VARCHAR(50),
        locale VARCHAR(20),
        is_debug BOOLEAN NOT NULL DEFAULT FALSE,
        experiments JSONB,
        "timestamp" TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      ) PARTITION BY RANGE ("timestamp");
    `);
  }

  // Rename platform → environment on events table if still using old column name
  const evtColCheck = await migrationClient`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'platform'
  `;
  if (evtColCheck.length > 0) {
    await migrationClient.unsafe(`
      ALTER TABLE events RENAME COLUMN platform TO environment;
      UPDATE events SET environment = 'backend' WHERE environment = 'server';
      ALTER TABLE events ALTER COLUMN environment TYPE environment USING environment::environment
    `);
  }

  // Set up partitioned metric_events table
  const meResult = await migrationClient`
    SELECT relkind FROM pg_class WHERE relname = 'metric_events'
  `;

  if (meResult.length > 0 && meResult[0].relkind !== "p") {
    await migrationClient`DROP TABLE IF EXISTS metric_events CASCADE`;
  }

  // Ensure metric_phase enum exists
  const metricPhaseCheck = await migrationClient`
    SELECT 1 FROM pg_type WHERE typname = 'metric_phase'
  `;
  if (metricPhaseCheck.length === 0) {
    await migrationClient.unsafe(`CREATE TYPE metric_phase AS ENUM ('start', 'complete', 'fail', 'cancel', 'record')`);
  }

  // Ensure metric_status enum exists
  const metricStatusCheck = await migrationClient`
    SELECT 1 FROM pg_type WHERE typname = 'metric_status'
  `;
  if (metricStatusCheck.length === 0) {
    await migrationClient.unsafe(`CREATE TYPE metric_status AS ENUM ('active', 'paused')`);
  }

  if (meResult.length === 0 || meResult[0].relkind !== "p") {
    await migrationClient.unsafe(`
      CREATE TABLE IF NOT EXISTS metric_events (
        id UUID DEFAULT gen_random_uuid(),
        app_id UUID NOT NULL,
        session_id UUID NOT NULL,
        user_id VARCHAR(255),
        api_key_id UUID,
        metric_slug VARCHAR(255) NOT NULL,
        phase metric_phase NOT NULL,
        tracking_id UUID,
        duration_ms INTEGER,
        error TEXT,
        attributes JSONB,
        environment environment,
        os_version VARCHAR(50),
        app_version VARCHAR(50),
        device_model VARCHAR(100),
        build_number VARCHAR(50),
        is_debug BOOLEAN NOT NULL DEFAULT FALSE,
        client_event_id UUID,
        "timestamp" TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      ) PARTITION BY RANGE ("timestamp");
    `);
  }

  // Remove stale log_level enum values if present
  const staleEnumCheck = await migrationClient`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'log_level')
      AND enumlabel IN ('tracking', 'attention')
  `;
  if (staleEnumCheck.length > 0) {
    for (const row of staleEnumCheck) {
      try { await migrationClient.unsafe(`UPDATE events SET level = 'info' WHERE level = '${row.enumlabel}'`); } catch {}
    }
    await migrationClient.unsafe(`ALTER TYPE log_level RENAME TO log_level_old`);
    await migrationClient.unsafe(`CREATE TYPE log_level AS ENUM ('info', 'debug', 'warn', 'error')`);
    try { await migrationClient.unsafe(`ALTER TABLE events ALTER COLUMN level TYPE log_level USING level::text::log_level`); } catch {}
    await migrationClient.unsafe(`DROP TYPE log_level_old`);
  }

  // Set up partitioned funnel_events table
  const feResult = await migrationClient`
    SELECT relkind FROM pg_class WHERE relname = 'funnel_events'
  `;

  if (feResult.length > 0 && feResult[0].relkind !== "p") {
    await migrationClient`DROP TABLE IF EXISTS funnel_events CASCADE`;
  }

  if (feResult.length === 0 || feResult[0].relkind !== "p") {
    await migrationClient.unsafe(`
      CREATE TABLE IF NOT EXISTS funnel_events (
        id UUID DEFAULT gen_random_uuid(),
        app_id UUID NOT NULL,
        session_id UUID NOT NULL,
        user_id VARCHAR(255),
        api_key_id UUID,
        step_name VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        screen_name VARCHAR(255),
        custom_attributes JSONB,
        experiments JSONB,
        environment environment,
        os_version VARCHAR(50),
        app_version VARCHAR(50),
        device_model VARCHAR(100),
        build_number VARCHAR(50),
        is_debug BOOLEAN NOT NULL DEFAULT FALSE,
        client_event_id UUID,
        "timestamp" TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      ) PARTITION BY RANGE ("timestamp");
    `);
  }

  // Create partitions using shared utility
  await ensurePartitions(migrationClient, 1);
  await ensureMetricEventPartitions(migrationClient, 1);
  await ensureFunnelEventPartitions(migrationClient, 1);

  await migrationClient.end();
  migrationClient = null;
}

export const testEmailService = new TestEmailService();

export async function buildApp() {
  const app = Fastify({ logger: false });
  const db = createDatabaseConnection(TEST_DB_URL);

  app.decorate("db", db);
  app.decorate("emailService", testEmailService as EmailService);
  await app.register(decompressPlugin);
  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: "test-secret" });

  app.get("/health", async () => ({ status: "ok" }));
  await app.register(authRoutes, { prefix: "/v1/auth" });
  await app.register(ingestRoutes, { prefix: "/v1" });
  await app.register(eventsRoutes, { prefix: "/v1" });
  await app.register(appsRoutes, { prefix: "/v1" });
  await app.register(projectsRoutes, { prefix: "/v1" });
  await app.register(identityRoutes, { prefix: "/v1" });
  await app.register(appUsersRoutes, { prefix: "/v1" });
  await app.register(teamsRoutes, { prefix: "/v1" });
  await app.register(invitationRoutes, { prefix: "/v1" });
  await app.register(metricsRoutes, { prefix: "/v1" });
  await app.register(funnelsRoutes, { prefix: "/v1" });
  await app.register(auditLogsRoutes, { prefix: "/v1" });

  await app.ready();
  return app;
}

export async function truncateAll() {
  const client = postgres(TEST_DB_URL, { max: 1 });
  await client`DELETE FROM audit_logs`;
  await client`DELETE FROM app_users`;
  await client.unsafe(`DELETE FROM funnel_events`);
  await client`DELETE FROM funnel_definitions`;
  await client.unsafe(`DELETE FROM metric_events`);
  await client`DELETE FROM metric_definitions`;
  await client.unsafe(`DELETE FROM events`);
  await client`DELETE FROM api_keys`;
  await client`DELETE FROM apps`;
  await client`DELETE FROM projects`;
  await client`DELETE FROM team_invitations`;
  await client`DELETE FROM team_members`;
  await client`DELETE FROM teams`;
  await client`DELETE FROM email_verification_codes`;
  await client`DELETE FROM users`;
  await client.end();
}

export async function seedTestData() {
  const client = postgres(TEST_DB_URL, { max: 1 });

  const [user] = await client`
    INSERT INTO users (email, name)
    VALUES (${TEST_USER.email}, ${TEST_USER.name})
    RETURNING id
  `;

  const [team] = await client`
    INSERT INTO teams (name, slug)
    VALUES ('Test Team', 'test-team')
    RETURNING id
  `;

  await client`
    INSERT INTO team_members (team_id, user_id, role)
    VALUES (${team.id}, ${user.id}, 'owner')
  `;

  const [project] = await client`
    INSERT INTO projects (team_id, name, slug)
    VALUES (${team.id}, 'Test Project', 'test-project')
    RETURNING id
  `;

  const [app] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id, client_key)
    VALUES (${team.id}, ${project.id}, 'Test App', 'apple', ${TEST_BUNDLE_ID}, ${TEST_CLIENT_KEY})
    RETURNING id
  `;

  // Client key (events:write, scoped to app)
  await client`
    INSERT INTO api_keys (key_hash, key_prefix, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${hashApiKey(TEST_CLIENT_KEY)},
      ${TEST_CLIENT_KEY.slice(0, KEY_PREFIX_LENGTH)},
      'client',
      ${app.id},
      ${team.id},
      'Test Client Key',
      ${user.id},
      ${JSON.stringify(["events:write"])}::jsonb
    )
  `;

  // Agent key (events:read, funnels:read, team-wide)
  await client`
    INSERT INTO api_keys (key_hash, key_prefix, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${hashApiKey(TEST_AGENT_KEY)},
      ${TEST_AGENT_KEY.slice(0, KEY_PREFIX_LENGTH)},
      'agent',
      ${null},
      ${team.id},
      'Test Agent Key',
      ${user.id},
      ${JSON.stringify(["events:read", "funnels:read", "apps:read", "projects:read", "metrics:read"])}::jsonb
    )
  `;

  // Separate project for backend app
  const [backendProject] = await client`
    INSERT INTO projects (team_id, name, slug)
    VALUES (${team.id}, 'Test Backend Project', 'test-backend-project')
    RETURNING id
  `;

  // Backend app (no bundle_id, in its own project)
  const [backendApp] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id, client_key)
    VALUES (${team.id}, ${backendProject.id}, 'Test Backend App', 'backend', ${null}, ${TEST_BACKEND_CLIENT_KEY})
    RETURNING id
  `;

  // Backend client key (events:write, scoped to backend app)
  await client`
    INSERT INTO api_keys (key_hash, key_prefix, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${hashApiKey(TEST_BACKEND_CLIENT_KEY)},
      ${TEST_BACKEND_CLIENT_KEY.slice(0, KEY_PREFIX_LENGTH)},
      'client',
      ${backendApp.id},
      ${team.id},
      'Test Backend Client Key',
      ${user.id},
      ${JSON.stringify(["events:write"])}::jsonb
    )
  `;

  // Separate project for android app
  const [androidProject] = await client`
    INSERT INTO projects (team_id, name, slug)
    VALUES (${team.id}, 'Test Android Project', 'test-android-project')
    RETURNING id
  `;

  // Android app
  const [androidApp] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id, client_key)
    VALUES (${team.id}, ${androidProject.id}, 'Test Android App', 'android', ${TEST_ANDROID_BUNDLE_ID}, ${TEST_ANDROID_CLIENT_KEY})
    RETURNING id
  `;

  // Android client key (events:write, scoped to android app)
  await client`
    INSERT INTO api_keys (key_hash, key_prefix, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${hashApiKey(TEST_ANDROID_CLIENT_KEY)},
      ${TEST_ANDROID_CLIENT_KEY.slice(0, KEY_PREFIX_LENGTH)},
      'client',
      ${androidApp.id},
      ${team.id},
      'Test Android Client Key',
      ${user.id},
      ${JSON.stringify(["events:write"])}::jsonb
    )
  `;

  // Expired client key
  await client`
    INSERT INTO api_keys (key_hash, key_prefix, key_type, app_id, team_id, name, created_by, permissions, expires_at)
    VALUES (
      ${hashApiKey(TEST_EXPIRED_KEY)},
      ${TEST_EXPIRED_KEY.slice(0, KEY_PREFIX_LENGTH)},
      'client',
      ${app.id},
      ${team.id},
      'Expired Key',
      ${user.id},
      ${JSON.stringify(["events:write"])}::jsonb,
      ${new Date("2020-01-01")}
    )
  `;

  await client.end();

  return {
    userId: user.id,
    teamId: team.id,
    projectId: project.id,
    appId: app.id,
    backendProjectId: backendProject.id,
    backendAppId: backendApp.id,
    androidProjectId: androidProject.id,
    androidAppId: androidApp.id,
  };
}

/**
 * Creates a user via the send-code/verify-code flow and returns token + user info.
 */
export async function createUserAndGetToken(
  app: FastifyInstance,
  email: string,
  name?: string,
): Promise<{ token: string; user: any; teams: any[]; userId: string; teamId: string }> {
  // Send code
  await app.inject({
    method: "POST",
    url: "/v1/auth/send-code",
    payload: { email },
  });

  const code = testEmailService.lastCode;

  // Verify code
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/verify-code",
    payload: { email, code },
  });

  const body = res.json();

  // Optionally update name if provided and different
  if (name && body.user.name !== name) {
    await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${body.token}` },
      payload: { name },
    });
  }

  return {
    token: body.token,
    user: body.user,
    teams: body.teams,
    userId: body.user.id,
    teamId: body.teams[0].id,
  };
}

/**
 * Logs in the seeded test user and returns the JWT token and the user's first team ID.
 */
export async function getTokenAndTeamId(app: FastifyInstance) {
  // Send code for existing test user
  await app.inject({
    method: "POST",
    url: "/v1/auth/send-code",
    payload: { email: TEST_USER.email },
  });

  const code = testEmailService.lastCode;

  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/verify-code",
    payload: { email: TEST_USER.email, code },
  });

  const body = res.json();
  return { token: body.token, teamId: body.teams[0].id };
}

/**
 * Shorthand — returns just the JWT token.
 */
export async function getToken(app: FastifyInstance) {
  const { token } = await getTokenAndTeamId(app);
  return token;
}

/**
 * Creates an agent API key with the given permissions and returns the full key string.
 */
export async function createAgentKey(
  app: FastifyInstance,
  token: string,
  teamId: string,
  permissions: Permission[]
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/keys",
    headers: { authorization: `Bearer ${token}` },
    payload: { name: "Custom Agent Key", key_type: "agent", team_id: teamId, permissions },
  });
  return res.json().key;
}

/**
 * Directly inserts a team member via DB (bypasses invitation flow).
 * Useful for tests that need members without going through email invitations.
 */
export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole = "member"
): Promise<void> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  await client`
    INSERT INTO team_members (team_id, user_id, role)
    VALUES (${teamId}, ${userId}, ${role})
  `;
  await client.end();
}
