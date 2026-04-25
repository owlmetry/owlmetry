import type { Db } from "@owlmetry/db";
import type { FastifyInstance } from "fastify";
import type { TeamRole, Permission, ApiKeyType } from "@owlmetry/shared";
import type { EmailService } from "./services/email.js";
import type { JobRunner } from "./services/job-runner.js";
import type { NotificationDispatcher } from "./services/notifications/dispatcher.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    databaseUrl: string;
    emailService: EmailService;
    jobRunner: JobRunner;
    notificationDispatcher: NotificationDispatcher;
  }
}

export interface UserJwtPayload {
  sub: string; // user id
  email: string;
}

export interface ApiKeyContext {
  type: "api_key";
  key_id: string;
  key_type: ApiKeyType;
  app_id: string | null;
  team_id: string;
  created_by: string;
  permissions: Permission[];
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
}

export type AuthContext = ApiKeyContext | UserContext;
