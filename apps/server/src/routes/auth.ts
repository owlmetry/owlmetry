import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, gte, sql } from "drizzle-orm";
import { users, teams, teamMembers, apiKeys, apps, emailVerificationCodes } from "@owlmetry/db";
import { DEFAULT_API_KEY_PERMISSIONS, validatePermissionsForKeyType, generateApiKey, generateVerificationCode, hashVerificationCode } from "@owlmetry/shared";
import type {
  SendCodeRequest,
  VerifyCodeRequest,
  CreateApiKeyRequest,
  UpdateApiKeyRequest,
  UpdateMeRequest,
  Permission,
} from "@owlmetry/shared";
import { requireAuth, hasTeamAccess, getAuthTeamIds, getUserTeamMemberships, assertTeamRole } from "../middleware/auth.js";
import type { UserJwtPayload } from "../types.js";
import { serializeApiKey } from "../utils/serialize.js";
import { config } from "../config.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: "strict" as const,
  path: "/",
  maxAge: 7 * 24 * 60 * 60, // 7 days, matching JWT expiry
};

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
  // Send verification code
  app.post<{ Body: SendCodeRequest }>("/send-code", async (request, reply) => {
    const { email } = request.body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return reply.code(400).send({ error: "Valid email is required" });
    }

    // Rate limit: max 5 codes per email per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCodes = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.email, email),
          gte(emailVerificationCodes.created_at, oneHourAgo),
        )
      );

    if (recentCodes[0].count >= 5) {
      return reply.code(429).send({ error: "Too many verification codes requested. Try again later." });
    }

    const { code, codeHash } = generateVerificationCode();

    await app.db.insert(emailVerificationCodes).values({
      email,
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    });

    await app.emailService.sendVerificationCode(email, code);

    return { message: "Verification code sent" };
  });

  // Verify code and authenticate
  app.post<{ Body: VerifyCodeRequest }>("/verify-code", async (request, reply) => {
    const { email, code } = request.body;

    if (!email || !code) {
      return reply.code(400).send({ error: "email and code required" });
    }

    const codeHash = hashVerificationCode(code);

    const [match] = await app.db
      .select()
      .from(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.email, email),
          eq(emailVerificationCodes.code_hash, codeHash),
          isNull(emailVerificationCodes.used_at),
          gte(emailVerificationCodes.expires_at, new Date()),
        )
      )
      .limit(1);

    if (!match) {
      return reply.code(401).send({ error: "Invalid or expired code" });
    }

    // Mark code as used
    await app.db
      .update(emailVerificationCodes)
      .set({ used_at: new Date() })
      .where(eq(emailVerificationCodes.id, match.id));

    // Check for existing user
    const [existingUser] = await app.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let user: typeof existingUser;
    let isNewUser = false;
    let membershipTeams: Awaited<ReturnType<typeof getUserTeamMemberships>>;

    if (existingUser) {
      user = existingUser;
      membershipTeams = await getUserTeamMemberships(app.db, user.id);
    } else {
      // Create new user
      const localPart = email.split("@")[0];
      const name = localPart.charAt(0).toUpperCase() + localPart.slice(1);

      const [newUser] = await app.db
        .insert(users)
        .values({ email, name })
        .returning();

      // Create default team
      const slug = generateSlugFromName(name) || "team";
      const [team] = await app.db
        .insert(teams)
        .values({ name: `${name}'s Team`, slug: `${slug}-${newUser.id.slice(0, 8)}` })
        .returning();

      await app.db.insert(teamMembers).values({
        team_id: team.id,
        user_id: newUser.id,
        role: "owner",
      });

      user = newUser;
      isNewUser = true;
      membershipTeams = [
        {
          id: team.id,
          name: team.name,
          slug: team.slug,
          role: "owner" as const,
        },
      ];
    }

    const token = app.jwt.sign(
      {
        sub: user.id,
        email: user.email,
      } satisfies UserJwtPayload,
      { expiresIn: "7d" }
    );

    reply.setCookie("token", token, COOKIE_OPTIONS);

    const statusCode = isNewUser ? 201 : 200;
    return reply.code(statusCode).send({
      token,
      user: serializeUser(user),
      teams: membershipTeams,
      is_new_user: isNewUser,
    });
  });

  // Logout
  app.post("/logout", async (_request, reply) => {
    reply.clearCookie("token", { path: "/" });
    return { success: true };
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

      const { name } = request.body;

      if (!name) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      const [updated] = await app.db
        .update(users)
        .set({ name })
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
        api_keys: rows.map(serializeApiKey),
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

      return { api_key: serializeApiKey(key) };
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
        .select({
          id: apiKeys.id,
          team_id: apiKeys.team_id,
          key_type: apiKeys.key_type,
        })
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
        const permissionError = validatePermissionsForKeyType(key.key_type as import("@owlmetry/shared").ApiKeyType, permissions);
        if (permissionError) {
          return reply.code(400).send({ error: permissionError });
        }
      }

      const updates: Partial<{ name: string; permissions: Permission[] }> = {};
      if (name) updates.name = name;
      if (permissions) updates.permissions = permissions;

      const [updated] = await app.db
        .update(apiKeys)
        .set(updates)
        .where(eq(apiKeys.id, request.params.id))
        .returning();

      return { api_key: serializeApiKey(updated) };
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

      const { fullKey, keyHash, keyPrefix } = generateApiKey(key_type);

      const expires_at = expires_in_days
        ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
        : null;

      const [apiKey] = await app.db
        .insert(apiKeys)
        .values({
          key_hash: keyHash,
          key_prefix: keyPrefix,
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
        api_key: serializeApiKey(apiKey),
      });
    }
  );
}
