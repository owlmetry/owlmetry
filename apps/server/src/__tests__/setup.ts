import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@owlmetry/db";
import { createDatabaseConnection, ensurePartitions } from "@owlmetry/db";
import { hashApiKey, KEY_PREFIX_LENGTH } from "@owlmetry/shared";
import type { Permission } from "@owlmetry/shared";
import { authRoutes } from "../routes/auth.js";
import { ingestRoutes } from "../routes/ingest.js";
import { eventsRoutes } from "../routes/events.js";
import { appsRoutes } from "../routes/apps.js";
import { projectsRoutes } from "../routes/projects.js";
import { identityRoutes } from "../routes/identity.js";
import { appUsersRoutes } from "../routes/app-users.js";
import { teamsRoutes } from "../routes/teams.js";
import { decompressPlugin } from "../middleware/decompress.js";
import bcrypt from "bcrypt";

export const TEST_DB_URL = "postgres://localhost:5432/owlmetry_test";

export const TEST_CLIENT_KEY =
  "owl_client_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const TEST_AGENT_KEY =
  "owl_agent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const TEST_EXPIRED_KEY =
  "owl_client_cccccccccccccccccccccccccccccccccccccccccccccc";
export const TEST_SERVER_KEY =
  "owl_server_dddddddddddddddddddddddddddddddddddddddddddd";
export const TEST_BUNDLE_ID = "com.owlmetry.test";
export const TEST_SESSION_ID = "00000000-0000-0000-0000-000000000001";
export const TEST_USER = {
  email: "test@owlmetry.com",
  password: "testpass123",
  name: "Test User",
};

let migrationClient: postgres.Sql | null = null;

export async function setupTestDb() {
  migrationClient = postgres(TEST_DB_URL, { max: 1 });

  // Add 'server' to api_key_type enum if not present (ALTER TYPE ... ADD VALUE
  // cannot run inside a transaction, which Drizzle's migrator uses)
  const enumCheck = await migrationClient`
    SELECT 1 FROM pg_enum WHERE enumlabel = 'server'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'api_key_type')
  `;
  if (enumCheck.length === 0) {
    await migrationClient.unsafe(`ALTER TYPE api_key_type ADD VALUE 'server'`);
  }

  // Make bundle_id nullable if not already
  const colCheck = await migrationClient`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'apps' AND column_name = 'bundle_id'
  `;
  if (colCheck.length > 0 && colCheck[0].is_nullable === 'NO') {
    await migrationClient`ALTER TABLE apps ALTER COLUMN bundle_id DROP NOT NULL`;
  }

  const migrationDb = drizzle(migrationClient);
  await migrate(migrationDb, {
    migrationsFolder: "../../packages/db/drizzle",
  });

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
        client_event_id VARCHAR(255),
        session_id UUID NOT NULL,
        user_id VARCHAR(255),
        level log_level NOT NULL,
        source_module TEXT,
        message TEXT NOT NULL,
        screen_name VARCHAR(255),
        custom_attributes JSONB,
        platform VARCHAR(20),
        os_version VARCHAR(50),
        app_version VARCHAR(50),
        device_model VARCHAR(100),
        build_number VARCHAR(50),
        locale VARCHAR(20),
        "timestamp" TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      ) PARTITION BY RANGE ("timestamp");
    `);
  }

  // Create partitions using shared utility
  await ensurePartitions(migrationClient, 1);

  await migrationClient.end();
  migrationClient = null;
}

export async function buildApp() {
  const app = Fastify({ logger: false });
  const db = createDatabaseConnection(TEST_DB_URL);

  app.decorate("db", db);
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

  await app.ready();
  return app;
}

export async function truncateAll() {
  const client = postgres(TEST_DB_URL, { max: 1 });
  await client`DELETE FROM app_users`;
  await client`DELETE FROM funnel_progress`;
  await client`DELETE FROM funnel_definitions`;
  await client.unsafe(`DELETE FROM events`);
  await client`DELETE FROM api_keys`;
  await client`DELETE FROM apps`;
  await client`DELETE FROM projects`;
  await client`DELETE FROM team_members`;
  await client`DELETE FROM teams`;
  await client`DELETE FROM users`;
  await client.end();
}

export async function seedTestData() {
  const client = postgres(TEST_DB_URL, { max: 1 });

  const passwordHash = await bcrypt.hash(TEST_USER.password, 4); // low rounds for speed

  const [user] = await client`
    INSERT INTO users (email, password_hash, name)
    VALUES (${TEST_USER.email}, ${passwordHash}, ${TEST_USER.name})
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
    VALUES (${team.id}, ${project.id}, 'Test App', 'ios', ${TEST_BUNDLE_ID}, ${TEST_CLIENT_KEY})
    RETURNING id
  `;

  // Client key (events:write, scoped to app)
  await client`
    INSERT INTO api_keys (key_hash, key_prefix, key_type, app_id, team_id, name, permissions)
    VALUES (
      ${hashApiKey(TEST_CLIENT_KEY)},
      ${TEST_CLIENT_KEY.slice(0, KEY_PREFIX_LENGTH)},
      'client',
      ${app.id},
      ${team.id},
      'Test Client Key',
      ${JSON.stringify(["events:write"])}::jsonb
    )
  `;

  // Agent key (events:read, funnels:read, team-wide)
  await client`
    INSERT INTO api_keys (key_hash, key_prefix, key_type, app_id, team_id, name, permissions)
    VALUES (
      ${hashApiKey(TEST_AGENT_KEY)},
      ${TEST_AGENT_KEY.slice(0, KEY_PREFIX_LENGTH)},
      'agent',
      ${null},
      ${team.id},
      'Test Agent Key',
      ${JSON.stringify(["events:read", "funnels:read", "apps:read", "projects:read"])}::jsonb
    )
  `;

  // Expired client key
  await client`
    INSERT INTO api_keys (key_hash, key_prefix, key_type, app_id, team_id, name, permissions, expires_at)
    VALUES (
      ${hashApiKey(TEST_EXPIRED_KEY)},
      ${TEST_EXPIRED_KEY.slice(0, KEY_PREFIX_LENGTH)},
      'client',
      ${app.id},
      ${team.id},
      'Expired Key',
      ${JSON.stringify(["events:write"])}::jsonb,
      ${new Date("2020-01-01")}
    )
  `;

  await client.end();

  return { userId: user.id, teamId: team.id, projectId: project.id, appId: app.id };
}

/**
 * Logs in and returns the JWT token and the user's first team ID.
 */
export async function getTokenAndTeamId(app: FastifyInstance) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: TEST_USER.email, password: TEST_USER.password },
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
