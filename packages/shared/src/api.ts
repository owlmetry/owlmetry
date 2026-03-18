import type { StoredEvent, IngestRequest, IngestResponse, AppPlatform } from "./events.js";
import type { App, User, Team, Project, ApiKey, ApiKeyType, TeamRole, Permission } from "./auth.js";
import type { FunnelDefinition, FunnelStep, FunnelAnalytics } from "./funnels.js";

// Serialized response types (dates as ISO strings)
export type UserResponse = Omit<User, "created_at" | "updated_at"> & { created_at: string; updated_at: string };

// Auth
export interface SendCodeRequest {
  email: string;
}

export interface SendCodeResponse {
  message: string;
}

export interface VerifyCodeRequest {
  email: string;
  code: string;
}

export interface VerifyCodeResponse extends AuthResponse {
  is_new_user: boolean;
}

export interface AuthTeamMembership {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

export interface AuthResponse {
  token: string;
  user: UserResponse;
  teams: AuthTeamMembership[];
}

// Agent login (CLI auth flow — no JWT, returns agent API key directly)
export interface AgentLoginRequest {
  email: string;
  code: string;
  team_id?: string; // required if user has multiple teams
}

export interface AgentLoginResponse {
  api_key: string;
  team: { id: string; name: string; slug: string };
  project: { id: string; name: string; slug: string } | null;
  app: { id: string; name: string; platform: string } | null;
  is_new_setup: boolean;
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

// Serialized API key (dates as ISO strings, excludes deleted_at)
export type ApiKeyResponse = Omit<ApiKey, "created_at" | "updated_at" | "last_used_at" | "expires_at" | "deleted_at"> & {
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  expires_at: string | null;
};

export interface CreateApiKeyResponse {
  key: string; // full key, shown only once
  api_key: ApiKeyResponse;
}

// User profile
export interface MeResponse {
  user: UserResponse;
  teams: AuthTeamMembership[];
}

export interface UpdateMeRequest {
  name?: string;
}

export interface UpdateApiKeyRequest {
  name?: string;
  permissions?: Permission[];
}

// Single API key
export interface GetApiKeyResponse {
  api_key: ApiKeyResponse;
}

// API key listing
export interface ListApiKeysResponse {
  api_keys: ApiKeyResponse[];
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
  platform: AppPlatform;
  bundle_id?: string;
  project_id: string;
}

export interface UpdateAppRequest {
  name?: string;
}

export type AppResponse = Omit<App, "created_at" | "deleted_at"> & {
  created_at: string;
};

// Projects (serialized)
export type ProjectResponse = Omit<Project, "created_at" | "deleted_at"> & { created_at: string };
export type ProjectDetailResponse = ProjectResponse & { apps: AppResponse[] };

// Events (serialized — API returns ISO strings, not Date objects)
export type StoredEventResponse = Omit<StoredEvent, "timestamp" | "received_at"> & {
  timestamp: string;
  received_at: string;
};

// Events query
export interface EventsQueryParams {
  project_id?: string;
  app_id?: string;
  level?: string;
  user_id?: string;
  session_id?: string;
  screen_name?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
  include_debug?: string;
}

export interface EventsResponse {
  events: StoredEventResponse[];
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
  joined_at: string;
}

export interface TeamDetailResponse {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  members: TeamMemberResponse[];
}

// App Users
export interface AppUserResponse {
  id: string;
  app_id: string;
  user_id: string;
  is_anonymous: boolean;
  claimed_from: string[] | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AppUsersResponse {
  users: AppUserResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface AppUsersQueryParams {
  search?: string;
  is_anonymous?: string;
  cursor?: string;
  limit?: number;
}

// Re-export for convenience
export type {
  StoredEvent,
  IngestRequest,
  IngestResponse,
  AppPlatform,
  App,
  User,
  Team,
  Project,
  ApiKey,
  TeamRole,
  Permission,
  FunnelDefinition,
  FunnelAnalytics,
};
