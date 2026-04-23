import type { StoredEvent, IngestRequest, IngestResponse, AppPlatform } from "./events.js";
import type { App, User, Team, Project, ApiKey, ApiKeyType, TeamRole, Permission } from "./auth.js";
import type { FunnelDefinition, FunnelStep, FunnelAnalytics, FunnelDefinitionResponse, FunnelStepAnalytics, FunnelBreakdownGroup } from "./funnels.js";
import type { MetricDefinition, MetricSchemaDefinition, MetricAggregationRules, MetricPhase, StoredMetricEvent } from "./metrics.js";
import type { AuditAction, AuditActorType, AuditResourceType } from "./audit.js";
import type { IssueAlertFrequency } from "./issues.js";

// Data mode for global development/production filtering
export type DataMode = "production" | "development" | "all";

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
  default_agent_key?: string;
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
  api_key: ApiKeyResponse;
}

export interface DefaultAgentKeyResponse {
  secret: string;
  created: boolean;
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
  retention_days_events?: number;
  retention_days_metrics?: number;
  retention_days_funnels?: number;
}

export interface UpdateProjectRequest {
  name?: string;
  color?: string;
  retention_days_events?: number | null;
  retention_days_metrics?: number | null;
  retention_days_funnels?: number | null;
  attachment_user_quota_bytes?: number | null;
  attachment_project_quota_bytes?: number | null;
  issue_alert_frequency?: IssueAlertFrequency;
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

export type AppResponse = Omit<
  App,
  "created_at" | "deleted_at" | "latest_app_version_updated_at"
> & {
  created_at: string;
  client_secret: string | null;
  latest_app_version_updated_at: string | null;
};

// Projects (serialized)
export type ProjectResponse = Omit<Project, "created_at" | "deleted_at"> & {
  created_at: string;
  effective_retention_days_events: number;
  effective_retention_days_metrics: number;
  effective_retention_days_funnels: number;
  effective_attachment_user_quota_bytes: number;
  effective_attachment_project_quota_bytes: number;
  effective_issue_alert_frequency: IssueAlertFrequency;
};
export type ProjectDetailResponse = ProjectResponse & { apps: AppResponse[] };

// Events (serialized — API returns ISO strings, not Date objects)
export type StoredEventResponse = Omit<StoredEvent, "timestamp" | "received_at"> & {
  timestamp: string;
  received_at: string;
  project_id?: string;
};

// Events query
export interface EventsQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  level?: string;
  user_id?: string;
  session_id?: string;
  environment?: string;
  screen_name?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
  data_mode?: DataMode;
  order?: "asc" | "desc";
}

export interface EventsResponse {
  events: StoredEventResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface EventsCountQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  level?: string;
  user_id?: string;
  session_id?: string;
  environment?: string;
  screen_name?: string;
  since?: string;
  until?: string;
  data_mode?: DataMode;
}

export interface EventsCountResponse {
  count: number;
  unique_users: number;
  unique_sessions: number;
}

export interface CompletionsCountQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  since?: string;
  until?: string;
  data_mode?: DataMode;
}

export interface CompletionsCountResponse {
  count: number;
  started?: number;
}

// Funnels
export interface CreateFunnelRequest {
  name: string;
  slug: string;
  description?: string;
  steps: FunnelStep[];
}

export interface UpdateFunnelRequest {
  name?: string;
  description?: string;
  steps?: FunnelStep[];
}

export { FunnelDefinitionResponse };

export interface FunnelQueryParams {
  since?: string;
  until?: string;
  app_id?: string;
  app_version?: string;
  environment?: string;
  experiment?: string;
  mode?: "closed" | "open";
  group_by?: string;
  data_mode?: DataMode;
}

export interface FunnelQueryResponse {
  slug: string;
  analytics: FunnelAnalytics;
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
export interface AppUserAppInfo {
  app_id: string;
  app_name: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AppUserResponse {
  id: string;
  project_id: string;
  user_id: string;
  is_anonymous: boolean;
  claimed_from: string[] | null;
  properties: Record<string, string> | null;
  apps: AppUserAppInfo[];
  first_seen_at: string;
  last_seen_at: string;
  last_country_code: string | null;
  last_app_version: string | null;
}

export interface AppUsersResponse {
  users: AppUserResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface AppUsersQueryParams {
  search?: string;
  is_anonymous?: string;
  /** Comma-separated list of billing tiers to include: "paid", "trial", "free". */
  billing_status?: string;
  /** Sort order. "last_seen" (default) sorts by last_seen_at desc; "first_seen" sorts by first_seen_at desc. */
  sort?: "last_seen" | "first_seen";
  cursor?: string;
  limit?: number;
}

export interface TeamAppUsersQueryParams extends AppUsersQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  since?: string;
  until?: string;
}

// User Properties
export interface SetUserPropertiesRequest {
  user_id: string;
  properties: Record<string, string>;
}

export interface SetUserPropertiesResponse {
  updated: true;
  properties: Record<string, string>;
}

// Project Integrations
export interface IntegrationResponse {
  id: string;
  project_id: string;
  provider: string;
  config: Record<string, string>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookSetup {
  webhook_url: string;
  authorization_header: string;
  environment: string;
  events_filter: string;
}

export interface CreateIntegrationResponse extends IntegrationResponse {
  webhook_setup?: WebhookSetup;
}

export interface CreateIntegrationRequest {
  provider: string;
  config: Record<string, unknown>;
}

export interface UpdateIntegrationRequest {
  config?: Record<string, unknown>;
  enabled?: boolean;
}

// Metrics
export interface CreateMetricDefinitionRequest {
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
}

export type MetricDefinitionResponse = Omit<MetricDefinition, "created_at" | "updated_at" | "deleted_at"> & {
  created_at: string;
  updated_at: string;
};

export interface MetricQueryParams {
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
  FunnelStep,
  FunnelAnalytics,
  FunnelStepAnalytics,
  FunnelBreakdownGroup,
  MetricDefinition,
  MetricPhase,
  StoredMetricEvent,
};
