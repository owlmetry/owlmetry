import type { StoredEvent, IngestRequest, IngestResponse } from "./events.js";
import type { App, User, Team, Project, ApiKey, ApiKeyType } from "./auth.js";
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
  expires_in_days?: number;
}

export interface CreateApiKeyResponse {
  key: string; // full key, shown only once
  api_key: Omit<ApiKey, "created_at" | "last_used_at" | "expires_at"> & {
    created_at: string;
    expires_at: string | null;
  };
}

// Projects
export interface CreateProjectRequest {
  team_id: string;
  name: string;
  slug: string;
}

// Apps
export interface CreateAppRequest {
  name: string;
  platform: string;
  bundle_id: string;
  project_id: string;
}

// Events query
export interface EventsQueryParams {
  project_id?: string;
  app_id?: string;
  level?: string;
  user?: string;
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
  FunnelDefinition,
  FunnelAnalytics,
};
