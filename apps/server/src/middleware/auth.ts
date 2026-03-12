import type { FastifyRequest, FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiKeys, teamMembers } from "@owlmetry/db";
import { KEY_PREFIX } from "@owlmetry/shared";
import type { AuthContext, JwtPayload, ApiKeyContext, UserContext } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const header = request.headers.authorization;
  if (!header) {
    return reply.code(401).send({ error: "Missing authorization header" });
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return reply.code(401).send({ error: "Invalid authorization format" });
  }

  // API key auth
  if (
    token.startsWith(KEY_PREFIX.client) ||
    token.startsWith(KEY_PREFIX.agent)
  ) {
    const hash = hashKey(token);
    const db = request.server.db;
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.key_hash, hash))
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
      key_type: key.key_type,
      app_id: key.app_id,
      team_id: key.team_id,
      permissions: key.permissions,
    } satisfies ApiKeyContext;
    return;
  }

  // JWT auth
  try {
    const payload = (await request.jwtVerify()) as JwtPayload;
    request.auth = {
      type: "user",
      user_id: payload.sub,
      email: payload.email,
      team_id: payload.team_id,
      role: payload.role,
    } satisfies UserContext;
  } catch {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}

export function requirePermission(...perms: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    const auth = request.auth;
    if (auth.type === "user") return; // users have full access per role

    for (const perm of perms) {
      if (!auth.permissions.includes(perm)) {
        return reply.code(403).send({ error: `Missing permission: ${perm}` });
      }
    }
  };
}
