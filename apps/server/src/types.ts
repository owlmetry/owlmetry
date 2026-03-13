import type { Db } from "@owlmetry/db";
import type { FastifyInstance } from "fastify";
import type { TeamRole } from "@owlmetry/shared";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

export interface UserJwtPayload {
  sub: string; // user id
  email: string;
}

export interface ApiKeyContext {
  type: "api_key";
  key_id: string;
  key_type: "client" | "agent";
  app_id: string | null;
  team_id: string;
  permissions: string[];
}

export interface TeamMembership {
  team_id: string;
  role: TeamRole;
}

export interface UserContext {
  type: "user";
  user_id: string;
  email: string;
  team_memberships: TeamMembership[];
  /** Derived from team_memberships for backward compatibility. */
  team_ids: string[];
}

export type AuthContext = ApiKeyContext | UserContext;
