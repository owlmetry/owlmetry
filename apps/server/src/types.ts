import type { Db } from "@owlmetry/db";
import type { FastifyInstance } from "fastify";

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

export interface UserContext {
  type: "user";
  user_id: string;
  email: string;
  team_ids: string[];
}

export type AuthContext = ApiKeyContext | UserContext;
