import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { apiKeys, teams, teamMembers } from "@owlmetry/db";

import type { Db } from "@owlmetry/db";
import { API_KEY_PREFIX, meetsMinimumRole } from "@owlmetry/shared";
import type { AuthTeamMembership, TeamRole, Permission, ApiKeyType } from "@owlmetry/shared";
import type { AuthContext, UserJwtPayload, ApiKeyContext, UserContext } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

/** Returns all team IDs the authenticated context has access to. */
export function getAuthTeamIds(auth: AuthContext): string[] {
  return auth.type === "api_key"
    ? [auth.team_id]
    : auth.team_memberships.map((m) => m.team_id);
}

/** Checks if the authenticated context has access to a specific team. */
export function hasTeamAccess(auth: AuthContext, teamId: string): boolean {
  return getAuthTeamIds(auth).includes(teamId);
}

/** Fetches team memberships with full team details for a user. Includes default agent key per team. */
export async function getUserTeamMemberships(db: Db, userId: string): Promise<AuthTeamMembership[]> {
  const rows = await db
    .select({
      team_id: teamMembers.team_id,
      role: teamMembers.role,
      team_name: teams.name,
      team_slug: teams.slug,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.team_id))
    .where(and(eq(teamMembers.user_id, userId), isNull(teams.deleted_at)));

  if (rows.length === 0) return [];

  // Look up the first (oldest) agent key per team for MCP setup docs
  const teamIds = rows.map((r) => r.team_id);
  const agentKeys = await db
    .select({ team_id: apiKeys.team_id, secret: apiKeys.secret })
    .from(apiKeys)
    .where(and(
      inArray(apiKeys.team_id, teamIds),
      eq(apiKeys.key_type, "agent"),
      isNull(apiKeys.deleted_at),
    ))
    .orderBy(apiKeys.created_at);

  const keyMap = new Map<string, string>();
  for (const k of agentKeys) {
    if (!keyMap.has(k.team_id)) keyMap.set(k.team_id, k.secret);
  }

  return rows.map((m) => ({
    id: m.team_id,
    name: m.team_name,
    slug: m.team_slug,
    role: m.role,
    default_agent_key: keyMap.get(m.team_id),
  }));
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const header = request.headers.authorization;
  let token: string;

  if (header) {
    const [scheme, headerToken] = header.split(" ");
    if (scheme !== "Bearer" || !headerToken) {
      return reply.code(401).send({ error: "Invalid authorization format" });
    }
    token = headerToken;
  } else if (request.cookies?.token) {
    token = request.cookies.token;
  } else {
    return reply.code(401).send({ error: "Missing authorization" });
  }

  // API key auth
  if (
    token.startsWith(API_KEY_PREFIX.client) ||
    token.startsWith(API_KEY_PREFIX.agent)
  ) {
    const db = request.server.db;
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.secret, token), isNull(apiKeys.deleted_at)))
      .limit(1);

    if (!key) {
      return reply.code(401).send({ error: "Invalid API key" });
    }

    if (key.expires_at && key.expires_at < new Date()) {
      return reply.code(401).send({ error: "API key expired" });
    }

    // Update last_used_at (fire and forget)
    db.update(apiKeys)
      .set({ last_used_at: new Date() })
      .where(eq(apiKeys.id, key.id))
      .execute()
      .catch(() => {});

    request.auth = {
      type: "api_key",
      key_id: key.id,
      key_type: key.key_type as ApiKeyType,
      app_id: key.app_id,
      team_id: key.team_id,
      created_by: key.created_by,
      permissions: key.permissions as Permission[],
    } satisfies ApiKeyContext;
    return;
  }

  // JWT auth — identity only, team memberships preloaded
  try {
    const payload = request.server.jwt.verify<UserJwtPayload>(token);

    const db = request.server.db;
    const memberships = await db
      .select({ team_id: teamMembers.team_id, role: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.user_id, payload.sub));

    request.auth = {
      type: "user",
      user_id: payload.sub,
      email: payload.email,
      team_memberships: memberships,
    } satisfies UserContext;
  } catch {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}

export function requirePermission(...perms: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    const auth = request.auth;
    if (auth.type === "user") return; // users have full access per role

    const missing = perms.filter(perm => !auth.permissions.includes(perm));
    if (missing.length > 0) {
      return reply.code(403).send({
        error: `Missing permission${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
      });
    }
  };
}

/** Returns the user's role for a given team, or null if not a member. */
export function getTeamRole(auth: AuthContext, teamId: string): TeamRole | null {
  if (auth.type === "api_key") return null;
  const membership = auth.team_memberships.find((m) => m.team_id === teamId);
  return membership?.role ?? null;
}

/**
 * Checks that a user-authenticated request has at least `minimumRole` on the
 * given team. Returns an error string if the check fails, or null if it passes.
 * API key contexts are skipped (they use permission-based auth instead).
 */
export function assertTeamRole(
  auth: AuthContext,
  teamId: string,
  minimumRole: TeamRole
): string | null {
  if (auth.type === "api_key") return null; // API keys checked via requirePermission
  const role = getTeamRole(auth, teamId);
  if (!role) return "Not a member of this team";
  if (!meetsMinimumRole(role, minimumRole)) return `Requires ${minimumRole} role or higher`;
  return null;
}
