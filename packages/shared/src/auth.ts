export type TeamRole = "owner" | "admin" | "member";

export const VALID_TEAM_ROLES: TeamRole[] = ["owner", "admin", "member"];

/** Numeric hierarchy for role comparisons — higher = more privileged. */
export const TEAM_ROLE_HIERARCHY: Record<TeamRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
} as const;

/** Returns true if `actorRole` outranks `targetRole`. */
export function canManageRole(actorRole: TeamRole, targetRole: TeamRole): boolean {
  return TEAM_ROLE_HIERARCHY[actorRole] > TEAM_ROLE_HIERARCHY[targetRole];
}

/** Returns true if `role` meets the minimum required level. */
export function meetsMinimumRole(role: TeamRole, minimumRole: TeamRole): boolean {
  return TEAM_ROLE_HIERARCHY[role] >= TEAM_ROLE_HIERARCHY[minimumRole];
}

export type ApiKeyType = "client" | "agent";

export type Permission =
  | "events:write"
  | "events:read"
  | "funnels:read"
  | "apps:read"
  | "apps:write"
  | "keys:manage";

export const DEFAULT_API_KEY_PERMISSIONS: Record<ApiKeyType, Permission[]> = {
  client: ["events:write"],
  agent: ["events:read", "funnels:read"],
};

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: Date;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
  updated_at: Date;
}

export interface TeamMember {
  team_id: string;
  user_id: string;
  role: TeamRole;
}

export interface ApiKey {
  id: string;
  key_prefix: string;
  key_type: ApiKeyType;
  app_id: string | null;
  team_id: string;
  name: string;
  permissions: Permission[];
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  deleted_at: Date | null;
}

export interface Project {
  id: string;
  team_id: string;
  name: string;
  slug: string;
  created_at: Date;
  deleted_at: Date | null;
}

export interface App {
  id: string;
  team_id: string;
  project_id: string;
  name: string;
  platform: string;
  bundle_id: string;
  created_at: Date;
  deleted_at: Date | null;
}
