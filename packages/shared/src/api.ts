import type { StoredEvent, IngestRequest, IngestResponse } from "./events.js";
import type { App, User, Team, Project, ApiKey, ApiKeyType, TeamRole, Permission } from "./auth.js";
import type { FunnelDefinition, FunnelStep, FunnelAnalytics } from "./funnels.js";

// Auth
export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthTeamMembership {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

export interface AuthResponse {
  token: string;
  user: Omit<User, "created_at"> & { created_at: string };
  teams: AuthTeamMembership[];
}

// API Keys
export interface CreateApiKeyRequest {
  name: string;
  key_type: ApiKeyType;
  app_id?: string;
  team_id?: string; // required for agent keys (no app_id to derive team from)
  permissions?: Permission[];
  expires_in_days?: number;
}

export interface CreateApiKeyResponse {
  key: string; // full key, shown only once
  api_key: Omit<ApiKey, "created_at" | "last_used_at" | "expires_at"> & {
    created_at: string;
    expires_at: string | null;
  };
}

// User profile
export interface MeResponse {
  user: Omit<User, "created_at"> & { created_at: string };
  teams: AuthTeamMembership[];
}

export interface UpdateMeRequest {
  name?: string;
  password?: string;
}

// Single API key
export interface GetApiKeyResponse {
  api_key: Omit<ApiKey, "created_at" | "last_used_at" | "expires_at"> & {
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
  };
}

// API key listing
export interface ListApiKeysResponse {
  api_keys: Array<
    Omit<ApiKey, "created_at" | "last_used_at" | "expires_at"> & {
      created_at: string;
      last_used_at: string | null;
      expires_at: string | null;
    }
  >;
}

// API key deletion
export interface DeleteApiKeyResponse {
  deleted: true;
}

// Projects
export interface CreateProjectRequest {
  team_id: string;
  name: string;
  slug: string;
}

export interface UpdateProjectRequest {
  name?: string;
}

// Apps
export interface CreateAppRequest {
  name: string;
  platform: string;
  bundle_id: string;
  project_id: string;
}

export interface UpdateAppRequest {
  name?: string;
  bundle_id?: string;
}

// Events query
export interface EventsQueryParams {
  project_id?: string;
  app_id?: string;
  level?: string;
  user_id?: string;
  screen_name?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
}

export interface EventsResponse {
  events: StoredEvent[];
  cursor: string | null;
  has_more: boolean;
}

// Funnels
export interface CreateFunnelRequest {
  app_id: string;
  name: string;
  steps: FunnelStep[];
}

// Teams
export interface CreateTeamRequest {
  name: string;
  slug: string;
}

export interface UpdateTeamRequest {
  name?: string;
}

export interface AddTeamMemberRequest {
  email: string;
  role?: TeamRole;
}

export interface UpdateTeamMemberRoleRequest {
  role: TeamRole;
}

export interface TeamMemberResponse {
  user_id: string;
  email: string;
  name: string;
  role: TeamRole;
}

export interface TeamDetailResponse {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  members: TeamMemberResponse[];
}

// Re-export for convenience
export type {
  StoredEvent,
  IngestRequest,
  IngestResponse,
  App,
  User,
  Team,
  Project,
  ApiKey,
  TeamRole,
  FunnelDefinition,
  FunnelAnalytics,
};
