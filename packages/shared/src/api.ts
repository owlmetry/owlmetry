import type { StoredEvent, IngestRequest, IngestResponse, AppPlatform } from "./events.js";
import type { App, User, Team, Project, ApiKey, ApiKeyType, TeamRole, Permission } from "./auth.js";
import type { FunnelDefinition, FunnelStep, FunnelAnalytics } from "./funnels.js";
import type { MetricDefinition, MetricSchemaDefinition, MetricAggregationRules, MetricPhase, StoredMetricEvent } from "./metrics.js";
import type { AuditAction, AuditActorType, AuditResourceType } from "./audit.js";

// Data mode for global debug/production filtering
export type DataMode = "production" | "debug" | "all";

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
  app_name?: string | null;
  created_by_email?: string | null;
};

// Audit Logs
export interface AuditLogResponse {
  id: string;
  team_id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  changes: Record<string, { before?: unknown; after?: unknown }> | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface AuditLogsQueryParams {
  team_id: string;
  resource_type?: string;
  resource_id?: string;
  actor_id?: string;
  action?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditLogsResponse {
  audit_logs: AuditLogResponse[];
  cursor: string | null;
  has_more: boolean;
}

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
  team_id?: string;
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
  data_mode?: DataMode;
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

// Team Invitations
export interface CreateTeamInvitationRequest {
  email: string;
  role?: TeamRole;
}

export interface TeamInvitationResponse {
  id: string;
  team_id: string;
  email: string;
  role: TeamRole;
  invited_by: { user_id: string; name: string; email: string };
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface TeamInvitationPublicResponse {
  team_name: string;
  team_slug: string;
  role: TeamRole;
  email: string;
  invited_by_name: string;
  expires_at: string;
}

export interface AcceptInvitationRequest {
  token: string;
}

export interface AcceptInvitationResponse {
  team_id: string;
  team_name: string;
  role: TeamRole;
}

export interface TeamDetailResponse {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  members: TeamMemberResponse[];
  pending_invitations: TeamInvitationResponse[];
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

// Metrics
export interface CreateMetricDefinitionRequest {
  project_id: string;
  name: string;
  slug: string;
  description?: string;
  documentation?: string;
  schema_definition?: MetricSchemaDefinition;
  aggregation_rules?: MetricAggregationRules;
}

export interface UpdateMetricDefinitionRequest {
  name?: string;
  description?: string;
  documentation?: string;
  schema_definition?: MetricSchemaDefinition;
  aggregation_rules?: MetricAggregationRules;
  status?: "active" | "paused";
}

export type MetricDefinitionResponse = Omit<MetricDefinition, "created_at" | "updated_at" | "deleted_at"> & {
  created_at: string;
  updated_at: string;
};

export interface MetricQueryParams {
  project_id: string;
  since?: string;
  until?: string;
  app_id?: string;
  app_version?: string;
  device_model?: string;
  os_version?: string;
  user_id?: string;
  environment?: string;
  group_by?: string; // "app_id" | "app_version" | "device_model" | "os_version" | "environment" | "time:hour" | "time:day" | "time:week"
  data_mode?: DataMode;
}

export interface MetricAggregationResult {
  total_count: number;
  start_count: number;
  complete_count: number;
  fail_count: number;
  cancel_count: number;
  record_count: number;
  success_rate: number | null;
  duration_avg_ms: number | null;
  duration_p50_ms: number | null;
  duration_p95_ms: number | null;
  duration_p99_ms: number | null;
  unique_users: number;
  error_breakdown: Array<{ error: string; count: number }>;
  groups?: Array<{
    key: string;
    value: string;
    total_count: number;
    complete_count: number;
    fail_count: number;
    success_rate: number | null;
    duration_avg_ms: number | null;
  }>;
}

export interface MetricQueryResponse {
  slug: string;
  aggregation: MetricAggregationResult;
}

export type StoredMetricEventResponse = Omit<StoredMetricEvent, "timestamp" | "received_at"> & {
  timestamp: string;
  received_at: string;
};

export interface MetricEventsResponse {
  events: StoredMetricEventResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface MetricEventsQueryParams {
  project_id: string;
  phase?: MetricPhase;
  tracking_id?: string;
  user_id?: string;
  environment?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
  data_mode?: DataMode;
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
  MetricDefinition,
  MetricPhase,
  StoredMetricEvent,
};
