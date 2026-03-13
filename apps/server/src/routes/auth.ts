import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull } from "drizzle-orm";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { users, teams, teamMembers, apiKeys, apps } from "@owlmetry/db";
import { API_KEY_PREFIX, DEFAULT_API_KEY_PERMISSIONS, validatePermissionsForKeyType, hashApiKey } from "@owlmetry/shared";
import type {
  RegisterRequest,
  LoginRequest,
  CreateApiKeyRequest,
  UpdateApiKeyRequest,
  UpdateMeRequest,
} from "@owlmetry/shared";
import { requireAuth, hasTeamAccess, getAuthTeamIds, getUserTeamMemberships, assertTeamRole } from "../middleware/auth.js";
import type { UserJwtPayload } from "../types.js";

function serializeUser(user: { id: string; email: string; name: string; created_at: Date; updated_at: Date }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    created_at: user.created_at.toISOString(),
    updated_at: user.updated_at.toISOString(),
  };
}

function generateSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function authRoutes(app: FastifyInstance) {
  // Register
  app.post<{ Body: RegisterRequest }>("/register", async (request, reply) => {
    const { email, password, name } = request.body;

    if (!email || !password || !name) {
      return reply.code(400).send({ error: "email, password, and name required" });
    }

    // Check if user exists
    const existing = await app.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return reply.code(409).send({ error: "Email already registered" });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const [user] = await app.db
      .insert(users)
      .values({ email, password_hash, name })
      .returning();

    // Create default team
    const slug = generateSlugFromName(name) || "team";
    const [team] = await app.db
      .insert(teams)
      .values({ name: `${name}'s Team`, slug: `${slug}-${user.id.slice(0, 8)}` })
      .returning();

    await app.db.insert(teamMembers).values({
      team_id: team.id,
      user_id: user.id,
      role: "owner",
    });

    const token = app.jwt.sign(
      {
        sub: user.id,
        email: user.email,
      } satisfies UserJwtPayload,
      { expiresIn: "7d" }
    );

    return reply.code(201).send({
      token,
      user: serializeUser(user),
      teams: [
        {
          id: team.id,
          name: team.name,
          slug: team.slug,
          role: "owner" as const,
        },
      ],
    });
  });

  // Login
  app.post<{ Body: LoginRequest }>("/login", async (request, reply) => {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.code(400).send({ error: "email and password required" });
    }

    const [user] = await app.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const membershipTeams = await getUserTeamMemberships(app.db, user.id);

    if (membershipTeams.length === 0) {
      return reply.code(500).send({ error: "User has no team membership" });
    }

    const token = app.jwt.sign(
      {
        sub: user.id,
        email: user.email,
      } satisfies UserJwtPayload,
      { expiresIn: "7d" }
    );

    return {
      token,
      user: serializeUser(user),
      teams: membershipTeams,
    };
  });

  // List teams for authenticated user
  app.get(
    "/teams",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can list teams" });
      }

      return {
        teams: await getUserTeamMemberships(app.db, auth.user_id),
      };
    }
  );

  // Current user profile
  app.get(
    "/me",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can access this endpoint" });
      }

      const [user] = await app.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          created_at: users.created_at,
          updated_at: users.updated_at,
        })
        .from(users)
        .where(eq(users.id, auth.user_id))
        .limit(1);

      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }

      return {
        user: serializeUser(user),
        teams: await getUserTeamMemberships(app.db, auth.user_id),
      };
    }
  );

  // Update profile
  app.patch<{ Body: UpdateMeRequest }>(
    "/me",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can update their profile" });
      }

      const { name, password } = request.body;

      if (!name && !password) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      const updates: Partial<{ name: string; password_hash: string }> = {};
      if (name) updates.name = name;
      if (password) updates.password_hash = await bcrypt.hash(password, 12);

      const [updated] = await app.db
        .update(users)
        .set(updates)
        .where(eq(users.id, auth.user_id))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          created_at: users.created_at,
          updated_at: users.updated_at,
        });

      return {
        user: serializeUser(updated),
      };
    }
  );

  // List API keys
  app.get(
    "/keys",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can list API keys" });
      }

      const teamIds = getAuthTeamIds(auth);
      if (teamIds.length === 0) {
        return { api_keys: [] };
      }

      const rows = await app.db
        .select()
        .from(apiKeys)
        .where(
          and(inArray(apiKeys.team_id, teamIds), isNull(apiKeys.deleted_at))
        );

      return {
        api_keys: rows.map((k) => ({
          id: k.id,
          key_prefix: k.key_prefix,
          key_type: k.key_type,
          app_id: k.app_id,
          team_id: k.team_id,
          name: k.name,
          permissions: k.permissions,
          created_at: k.created_at.toISOString(),
          updated_at: k.updated_at.toISOString(),
          last_used_at: k.last_used_at?.toISOString() || null,
          expires_at: k.expires_at?.toISOString() || null,
        })),
      };
    }
  );

  // Get single API key
  app.get<{ Params: { id: string } }>(
    "/keys/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can view API keys" });
      }

      const [key] = await app.db
        .select()
        .from(apiKeys)
        .where(
          and(eq(apiKeys.id, request.params.id), isNull(apiKeys.deleted_at))
        )
        .limit(1);

      if (!key || !hasTeamAccess(auth, key.team_id)) {
        return reply.code(404).send({ error: "API key not found" });
      }

      return {
        api_key: {
          id: key.id,
          key_prefix: key.key_prefix,
          key_type: key.key_type,
          app_id: key.app_id,
          team_id: key.team_id,
          name: key.name,
          permissions: key.permissions,
          created_at: key.created_at.toISOString(),
          updated_at: key.updated_at.toISOString(),
          last_used_at: key.last_used_at?.toISOString() || null,
          expires_at: key.expires_at?.toISOString() || null,
        },
      };
    }
  );

  // Update API key
  app.patch<{ Params: { id: string }; Body: UpdateApiKeyRequest }>(
    "/keys/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can update API keys" });
      }

      const { name, permissions } = request.body;

      if (!name && !permissions) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      const [key] = await app.db
        .select()
        .from(apiKeys)
        .where(
          and(eq(apiKeys.id, request.params.id), isNull(apiKeys.deleted_at))
        )
        .limit(1);

      if (!key || !hasTeamAccess(auth, key.team_id)) {
        return reply.code(404).send({ error: "API key not found" });
      }

      const roleError = assertTeamRole(auth, key.team_id, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      if (permissions) {
        const permissionError = validatePermissionsForKeyType(key.key_type, permissions);
        if (permissionError) {
          return reply.code(400).send({ error: permissionError });
        }
      }

      const updates: Partial<{ name: string; permissions: string[] }> = {};
      if (name) updates.name = name;
      if (permissions) updates.permissions = permissions;

      const [updated] = await app.db
        .update(apiKeys)
        .set(updates)
        .where(eq(apiKeys.id, request.params.id))
        .returning();

      return {
        api_key: {
          id: updated.id,
          key_prefix: updated.key_prefix,
          key_type: updated.key_type,
          app_id: updated.app_id,
          team_id: updated.team_id,
          name: updated.name,
          permissions: updated.permissions,
          created_at: updated.created_at.toISOString(),
          updated_at: updated.updated_at.toISOString(),
          last_used_at: updated.last_used_at?.toISOString() || null,
          expires_at: updated.expires_at?.toISOString() || null,
        },
      };
    }
  );

  // Delete API key
  app.delete<{ Params: { id: string } }>(
    "/keys/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete API keys" });
      }

      const [key] = await app.db
        .select()
        .from(apiKeys)
        .where(
          and(eq(apiKeys.id, request.params.id), isNull(apiKeys.deleted_at))
        )
        .limit(1);

      if (!key || !hasTeamAccess(auth, key.team_id)) {
        return reply.code(404).send({ error: "API key not found" });
      }

      const deleteKeyRoleError = assertTeamRole(auth, key.team_id, "admin");
      if (deleteKeyRoleError) {
        return reply.code(403).send({ error: deleteKeyRoleError });
      }

      await app.db
        .update(apiKeys)
        .set({ deleted_at: new Date() })
        .where(eq(apiKeys.id, request.params.id));

      return { deleted: true };
    }
  );

  // Create API key
  app.post<{ Body: CreateApiKeyRequest }>(
    "/keys",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can create API keys" });
      }

      const { name, key_type, app_id, team_id, permissions: requestedPermissions, expires_in_days } = request.body;

      if (!name || !key_type) {
        return reply.code(400).send({ error: "name and key_type required" });
      }

      if (!["client", "agent"].includes(key_type)) {
        return reply.code(400).send({ error: "key_type must be 'client' or 'agent'" });
      }

      // Client keys must be scoped to an app
      if (key_type === "client" && !app_id) {
        return reply.code(400).send({ error: "Client keys require an app_id" });
      }

      // Agent keys without an app require a team_id
      if (key_type === "agent" && !app_id && !team_id) {
        return reply.code(400).send({ error: "Agent keys require a team_id or app_id" });
      }

      // Resolve team from app or body
      let resolvedTeamId: string;

      if (app_id) {
        const [appRecord] = await app.db
          .select()
          .from(apps)
          .where(and(eq(apps.id, app_id), isNull(apps.deleted_at)))
          .limit(1);

        if (!appRecord || !hasTeamAccess(auth, appRecord.team_id)) {
          return reply.code(404).send({ error: "App not found" });
        }
        resolvedTeamId = appRecord.team_id;
      } else {
        if (!hasTeamAccess(auth, team_id!)) {
          return reply.code(403).send({ error: "Not a member of this team" });
        }
        resolvedTeamId = team_id!;
      }

      const keyRoleError = assertTeamRole(auth, resolvedTeamId, "admin");
      if (keyRoleError) {
        return reply.code(403).send({ error: keyRoleError });
      }

      const permissions = requestedPermissions ?? DEFAULT_API_KEY_PERMISSIONS[key_type];
      const permissionError = validatePermissionsForKeyType(key_type, permissions);
      if (permissionError) {
        return reply.code(400).send({ error: permissionError });
      }

      const prefix = API_KEY_PREFIX[key_type];
      const fullKey = `${prefix}${randomBytes(24).toString("hex")}`;

      const expires_at = expires_in_days
        ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
        : null;

      const [apiKey] = await app.db
        .insert(apiKeys)
        .values({
          key_hash: hashApiKey(fullKey),
          key_prefix: fullKey.slice(0, 16),
          key_type,
          app_id: app_id || null,
          team_id: resolvedTeamId,
          name,
          permissions,
          expires_at,
        })
        .returning();

      return reply.code(201).send({
        key: fullKey,
        api_key: {
          id: apiKey.id,
          key_prefix: apiKey.key_prefix,
          key_type: apiKey.key_type,
          app_id: apiKey.app_id,
          team_id: apiKey.team_id,
          name: apiKey.name,
          permissions: apiKey.permissions,
          created_at: apiKey.created_at.toISOString(),
          updated_at: apiKey.updated_at.toISOString(),
          expires_at: apiKey.expires_at?.toISOString() || null,
        },
      });
    }
  );
}
