import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, gte, lt, sql } from "drizzle-orm";
import { users, teams, teamMembers, apiKeys, apps, projects, emailVerificationCodes } from "@owlmetry/db";
import { DEFAULT_API_KEY_PERMISSIONS, validatePermissionsForKeyType, generateApiKey, generateVerificationCode, hashVerificationCode } from "@owlmetry/shared";
import type {
  SendCodeRequest,
  VerifyCodeRequest,
  AgentLoginRequest,
  CreateApiKeyRequest,
  UpdateApiKeyRequest,
  UpdateMeRequest,
  Permission,
} from "@owlmetry/shared";
import { requireAuth, hasTeamAccess, getAuthTeamIds, getUserTeamMemberships, assertTeamRole } from "../middleware/auth.js";
import type { UserJwtPayload } from "../types.js";
import { serializeApiKey } from "../utils/serialize.js";
import { logAuditEvent } from "../utils/audit.js";
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

/** Consume a verification code: validates, marks used, returns true. Returns false if invalid/expired. */
async function consumeVerificationCode(db: Parameters<typeof getUserTeamMemberships>[0], email: string, code: string): Promise<boolean> {
  const codeHash = hashVerificationCode(code);

  const [match] = await db
    .select({ id: emailVerificationCodes.id })
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

  if (!match) return false;

  await db
    .update(emailVerificationCodes)
    .set({ used_at: new Date() })
    .where(eq(emailVerificationCodes.id, match.id));

  return true;
}

type MembershipTeam = Awaited<ReturnType<typeof getUserTeamMemberships>>[0];

/** Find existing user or create new user + default team. Returns user, whether new, and team memberships. */
async function findOrCreateUser(db: Parameters<typeof getUserTeamMemberships>[0], email: string): Promise<{
  user: { id: string; email: string; name: string; created_at: Date; updated_at: Date };
  isNewUser: boolean;
  membershipTeams: MembershipTeam[];
}> {
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) {
    return {
      user: existingUser,
      isNewUser: false,
      membershipTeams: await getUserTeamMemberships(db, existingUser.id),
    };
  }

  const localPart = email.split("@")[0];
  const name = localPart.charAt(0).toUpperCase() + localPart.slice(1);

  const [newUser] = await db
    .insert(users)
    .values({ email, name })
    .returning();

  const slug = generateSlugFromName(name) || "team";
  const [team] = await db
    .insert(teams)
    .values({ name: `${name}'s Team`, slug: `${slug}-${newUser.id.slice(0, 8)}` })
    .returning();

  await db.insert(teamMembers).values({
    team_id: team.id,
    user_id: newUser.id,
    role: "owner",
  });

  return {
    user: newUser,
    isNewUser: true,
    membershipTeams: [{ id: team.id, name: team.name, slug: team.slug, role: "owner" as const }],
  };
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

    try {
      await app.emailService.sendVerificationCode(email, code);
    } catch (err) {
      // Roll back the inserted code so it doesn't consume a rate-limit slot
      await app.db
        .delete(emailVerificationCodes)
        .where(and(eq(emailVerificationCodes.code_hash, codeHash), eq(emailVerificationCodes.email, email)));
      throw err;
    }

    // Lazily clean up expired codes for this email (fire-and-forget)
    app.db
      .delete(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.email, email),
          lt(emailVerificationCodes.expires_at, new Date()),
        )
      )
      .then(() => {}, () => {});

    return { message: "Verification code sent" };
  });

  // Verify code and authenticate (web dashboard flow — returns JWT)
  app.post<{ Body: VerifyCodeRequest }>("/verify-code", async (request, reply) => {
    const { email, code } = request.body;

    if (!email || !code) {
      return reply.code(400).send({ error: "email and code required" });
    }

    const valid = await consumeVerificationCode(app.db, email, code);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid or expired code" });
    }

    const { user, isNewUser, membershipTeams } = await findOrCreateUser(app.db, email);

    const token = app.jwt.sign(
      {
        sub: user.id,
        email: user.email,
      } satisfies UserJwtPayload,
      { expiresIn: "7d" }
    );

    reply.setCookie("token", token, COOKIE_OPTIONS);

    if (isNewUser && membershipTeams.length > 0) {
      const teamId = membershipTeams[0].id;
      const userAuth = { type: "user" as const, user_id: user.id, email: user.email, team_memberships: [{ team_id: teamId, role: "owner" as const }] };
      logAuditEvent(app.db, userAuth, { team_id: teamId, action: "create", resource_type: "user", resource_id: user.id });
      logAuditEvent(app.db, userAuth, { team_id: teamId, action: "create", resource_type: "team", resource_id: teamId });
      logAuditEvent(app.db, userAuth, { team_id: teamId, action: "create", resource_type: "team_member", resource_id: user.id, metadata: { role: "owner" } });
    }

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

      // Fetch current name for audit diff
      const [current] = await app.db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, auth.user_id))
        .limit(1);

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

      if (auth.team_memberships.length > 0) {
        logAuditEvent(app.db, auth, {
          team_id: auth.team_memberships[0].team_id,
          action: "update",
          resource_type: "user",
          resource_id: auth.user_id,
          changes: { name: { before: current?.name, after: name } },
        });
      }

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
          name: apiKeys.name,
          permissions: apiKeys.permissions,
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

      const changes: Record<string, { before?: unknown; after?: unknown }> = {};
      if (name && name !== key.name) changes.name = { before: key.name, after: name };
      if (permissions) changes.permissions = { before: key.permissions, after: permissions };
      if (Object.keys(changes).length > 0) {
        logAuditEvent(app.db, auth, {
          team_id: key.team_id,
          action: "update",
          resource_type: "api_key",
          resource_id: key.id,
          changes,
        });
      }

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

      logAuditEvent(app.db, auth, {
        team_id: key.team_id,
        action: "delete",
        resource_type: "api_key",
        resource_id: key.id,
        metadata: { name: key.name },
      });

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
          created_by: auth.user_id,
          permissions,
          expires_at,
        })
        .returning();

      logAuditEvent(app.db, auth, {
        team_id: resolvedTeamId,
        action: "create",
        resource_type: "api_key",
        resource_id: apiKey.id,
        metadata: { key_type, name },
      });

      return reply.code(201).send({
        key: fullKey,
        api_key: serializeApiKey(apiKey),
      });
    }
  );

  // Agent login — verify code + provision agent API key in one step (no JWT)
  app.post<{ Body: AgentLoginRequest }>("/agent-login", async (request, reply) => {
    const { email, code, team_id } = request.body;

    if (!email || !code) {
      return reply.code(400).send({ error: "email and code required" });
    }

    const valid = await consumeVerificationCode(app.db, email, code);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid or expired code" });
    }

    const { user: agentUser, membershipTeams } = await findOrCreateUser(app.db, email);

    if (membershipTeams.length === 0) {
      return reply.code(500).send({ error: "User has no team membership" });
    }

    // Resolve target team
    let targetTeam: MembershipTeam;

    if (team_id) {
      const found = membershipTeams.find((t) => t.id === team_id);
      if (!found) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }
      targetTeam = found;
    } else if (membershipTeams.length === 1) {
      targetTeam = membershipTeams[0];
    } else {
      return reply.code(400).send({
        error: "Multiple teams found. Specify team_id.",
        teams: membershipTeams,
      });
    }

    // Auto-provision if no projects exist
    const existingProjects = await app.db
      .select()
      .from(projects)
      .where(and(eq(projects.team_id, targetTeam.id), isNull(projects.deleted_at)))
      .limit(1);

    let provisionedProject: { id: string; name: string; slug: string } | null = null;
    let provisionedApp: { id: string; name: string; platform: string } | null = null;
    const isNewSetup = existingProjects.length === 0;

    if (isNewSetup) {
      const [project] = await app.db
        .insert(projects)
        .values({ team_id: targetTeam.id, name: "My Project", slug: "my-project" })
        .returning();

      provisionedProject = { id: project.id, name: project.name, slug: project.slug };

      const clientKeyData = generateApiKey("client");
      const [newApp] = await app.db
        .insert(apps)
        .values({
          team_id: targetTeam.id,
          project_id: project.id,
          name: "My App",
          platform: "backend",
          bundle_id: null,
          client_key: clientKeyData.fullKey,
        })
        .returning();

      await app.db.insert(apiKeys).values({
        key_hash: clientKeyData.keyHash,
        key_prefix: clientKeyData.keyPrefix,
        key_type: "client",
        app_id: newApp.id,
        team_id: targetTeam.id,
        name: "My App Client Key",
        created_by: agentUser.id,
        permissions: DEFAULT_API_KEY_PERMISSIONS.client,
      });

      provisionedApp = { id: newApp.id, name: newApp.name, platform: newApp.platform };
    }

    // Build auth context for audit logging (only target team needed)
    const agentLoginAuth = {
      type: "user" as const,
      user_id: agentUser.id,
      email: agentUser.email,
      team_memberships: [{ team_id: targetTeam.id, role: targetTeam.role }],
    };

    if (isNewSetup && provisionedProject) {
      logAuditEvent(app.db, agentLoginAuth, { team_id: targetTeam.id, action: "create", resource_type: "project", resource_id: provisionedProject.id, metadata: { name: provisionedProject.name } });
      if (provisionedApp) {
        logAuditEvent(app.db, agentLoginAuth, { team_id: targetTeam.id, action: "create", resource_type: "app", resource_id: provisionedApp.id, metadata: { name: provisionedApp.name, platform: provisionedApp.platform } });
      }
    }

    // Create agent API key
    const agentKeyData = generateApiKey("agent");
    const [agentApiKey] = await app.db.insert(apiKeys).values({
      key_hash: agentKeyData.keyHash,
      key_prefix: agentKeyData.keyPrefix,
      key_type: "agent",
      app_id: null,
      team_id: targetTeam.id,
      name: "CLI Agent Key",
      created_by: agentUser.id,
      permissions: DEFAULT_API_KEY_PERMISSIONS.agent,
    }).returning({ id: apiKeys.id });

    logAuditEvent(app.db, agentLoginAuth, {
      team_id: targetTeam.id,
      action: "create",
      resource_type: "api_key",
      resource_id: agentApiKey.id,
      metadata: { key_type: "agent", name: "CLI Agent Key" },
    });

    return reply.code(201).send({
      api_key: agentKeyData.fullKey,
      team: { id: targetTeam.id, name: targetTeam.name, slug: targetTeam.slug },
      project: provisionedProject,
      app: provisionedApp,
      is_new_setup: isNewSetup,
    });
  });
}
