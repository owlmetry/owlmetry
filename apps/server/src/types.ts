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
  team_id: string;
  role: TeamRole;
}

export interface ApiKeyContext {
  type: "api_key";
  key_id: string;
  key_type: "client" | "agent";
  app_id: string | null;
  app_bundle_id: string | null;
  team_id: string;
  permissions: string[];
}

export interface UserContext {
  type: "user";
  user_id: string;
  email: string;
  team_id: string;
  role: TeamRole;
}

export type AuthContext = ApiKeyContext | UserContext;
