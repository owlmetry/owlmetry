import type { NormalizedEvent, IngestRequest, IngestResponse } from "./events.js";
import type { App, User, Team, ApiKey, ApiKeyType } from "./auth.js";
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

export interface AuthResponse {
  token: string;
  user: Omit<User, "created_at"> & { created_at: string };
}

// API Keys
export interface CreateApiKeyRequest {
  name: string;
  key_type: ApiKeyType;
  app_id?: string;
  expires_in_days?: number;
}

export interface CreateApiKeyResponse {
  key: string; // full key, shown only once
  api_key: Omit<ApiKey, "created_at" | "last_used_at" | "expires_at"> & {
    created_at: string;
    expires_at: string | null;
  };
}

// Apps
export interface CreateAppRequest {
  name: string;
  platform: string;
  bundle_id?: string;
}

// Events query
export interface EventsQueryParams {
  app_id?: string;
  level?: string;
  user?: string;
  context?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
}

export interface EventsResponse {
  events: NormalizedEvent[];
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
  NormalizedEvent,
  IngestRequest,
  IngestResponse,
  App,
  User,
  Team,
  ApiKey,
  FunnelDefinition,
  FunnelAnalytics,
};
