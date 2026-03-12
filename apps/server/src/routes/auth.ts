import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { users, teams, teamMembers, apiKeys, apps } from "@owlmetry/db";
import { API_KEY_PREFIX, DEFAULT_API_KEY_PERMISSIONS, hashApiKey } from "@owlmetry/shared";
import type {
  RegisterRequest,
  LoginRequest,
  CreateApiKeyRequest,
} from "@owlmetry/shared";
import { requireAuth, hasTeamAccess } from "../middleware/auth.js";
import type { UserJwtPayload } from "../types.js";

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
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at.toISOString(),
      },
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

    // Get all team memberships
    const memberships = await app.db
      .select({
        team_id: teamMembers.team_id,
        role: teamMembers.role,
        team_name: teams.name,
        team_slug: teams.slug,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.team_id))
      .where(eq(teamMembers.user_id, user.id));

    if (memberships.length === 0) {
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
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at.toISOString(),
      },
      teams: memberships.map((m) => ({
        id: m.team_id,
        name: m.team_name,
        slug: m.team_slug,
        role: m.role,
      })),
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

      const memberships = await app.db
        .select({
          team_id: teamMembers.team_id,
          role: teamMembers.role,
          team_name: teams.name,
          team_slug: teams.slug,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.team_id))
        .where(eq(teamMembers.user_id, auth.user_id));

      return {
        teams: memberships.map((m) => ({
          id: m.team_id,
          name: m.team_name,
          slug: m.team_slug,
          role: m.role,
        })),
      };
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

      const { name, key_type, app_id, team_id, expires_in_days } = request.body;

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
          .where(eq(apps.id, app_id))
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

      const prefix = API_KEY_PREFIX[key_type];
      const fullKey = `${prefix}${randomBytes(24).toString("hex")}`;
      const permissions = DEFAULT_API_KEY_PERMISSIONS[key_type];

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
          expires_at: apiKey.expires_at?.toISOString() || null,
        },
      });
    }
  );
}
