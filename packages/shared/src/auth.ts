import type { AppPlatform } from "./events.js";

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
  | "funnels:write"
  | "apps:read"
  | "apps:write"
  | "projects:read"
  | "projects:write"
  | "metrics:read"
  | "metrics:write"
  | "audit_logs:read"
  | "users:write"
  | "integrations:read"
  | "integrations:write"
  | "jobs:read"
  | "jobs:write";

export const VALID_PERMISSIONS: Permission[] = [
  "events:write",
  "events:read",
  "funnels:read",
  "funnels:write",
  "apps:read",
  "apps:write",
  "projects:read",
  "projects:write",
  "metrics:read",
  "metrics:write",
  "audit_logs:read",
  "users:write",
  "integrations:read",
  "integrations:write",
  "jobs:read",
  "jobs:write",
];

export const ALLOWED_PERMISSIONS_BY_KEY_TYPE: Record<ApiKeyType, Permission[]> = {
  client: ["events:write", "users:write"],
  agent: ["events:read", "funnels:read", "funnels:write", "apps:read", "apps:write", "projects:read", "projects:write", "metrics:read", "metrics:write", "audit_logs:read", "users:write", "integrations:read", "integrations:write", "jobs:read", "jobs:write"],
};

export const DEFAULT_API_KEY_PERMISSIONS: Record<ApiKeyType, Permission[]> = {
  client: ["events:write", "users:write"],
  agent: ["events:read", "funnels:read", "funnels:write", "apps:read", "apps:write", "projects:read", "projects:write", "metrics:read", "metrics:write", "audit_logs:read", "users:write", "integrations:read", "integrations:write", "jobs:read", "jobs:write"],
};

/**
 * Validates that every permission in the array is valid for the given key type.
 * Returns an error string if invalid, or null if valid.
 */
export function validatePermissionsForKeyType(
  keyType: ApiKeyType,
  permissions: string[]
): string | null {
  if (permissions.length === 0) {
    return "At least one permission is required";
  }

  const unique = new Set(permissions);
  if (unique.size !== permissions.length) {
    return "Duplicate permissions are not allowed";
  }

  const allowed = ALLOWED_PERMISSIONS_BY_KEY_TYPE[keyType];
  for (const perm of permissions) {
    if (!VALID_PERMISSIONS.includes(perm as Permission)) {
      return `Unknown permission: ${perm}`;
    }
    if (!allowed.includes(perm as Permission)) {
      return `Permission "${perm}" is not allowed for ${keyType} keys`;
    }
  }

  return null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: Date;
  updated_at: Date;
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
  joined_at: Date;
}

export interface ApiKey {
  id: string;
  key_prefix: string;
  key_type: ApiKeyType;
  app_id: string | null;
  team_id: string;
  name: string;
  created_by: string | null;
  permissions: Permission[];
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
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
  platform: AppPlatform;
  bundle_id: string | null;
  client_key: string | null;
  created_at: Date;
  deleted_at: Date | null;
}
