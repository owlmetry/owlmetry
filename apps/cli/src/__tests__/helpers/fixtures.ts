import type {
  AppResponse,
  AppUserResponse,
  AuditLogResponse,
  FunnelDefinitionResponse,
  MetricDefinitionResponse,
  ProjectResponse,
  ProjectDetailResponse,
  StoredEventResponse,
  StoredMetricEventResponse,
} from "@owlmetry/shared";

export const PROJECT: ProjectResponse = {
  id: "p-1111-1111-1111-111111111111",
  team_id: "t-1111-1111-1111-111111111111",
  name: "My Project",
  slug: "my-project",
  created_at: "2025-01-15T10:00:00.000Z",
};

export const APP: AppResponse = {
  id: "a-1111-1111-1111-111111111111",
  team_id: "t-1111-1111-1111-111111111111",
  project_id: "p-1111-1111-1111-111111111111",
  name: "My iOS App",
  platform: "apple",
  bundle_id: "com.owlmetry.test",
  client_key: "owl_client_xxxx",
  created_at: "2025-01-15T10:00:00.000Z",
};

export const EVENT: StoredEventResponse = {
  id: "e-1111-1111-1111-111111111111",
  app_id: "a-1111-1111-1111-111111111111",
  session_id: "s-1111-1111-1111-111111111111",
  user_id: "user-123",
  level: "info",
  source_module: "AppDelegate",
  message: "App launched successfully",
  screen_name: "HomeScreen",
  custom_attributes: { build: "dev" },
  environment: "ios",
  os_version: "18.0",
  app_version: "1.0.0",
  build_number: "42",
  device_model: "iPhone 16",
  locale: "en_US",
  is_dev: false,
  experiments: null,
  timestamp: "2025-01-15T12:00:00.000Z",
  received_at: "2025-01-15T12:00:01.000Z",
};

export const METRIC_EVENT: StoredMetricEventResponse = {
  id: "me-1111-1111-1111-111111111111",
  app_id: "a-1111-1111-1111-111111111111",
  session_id: "s-1111-1111-1111-111111111111",
  user_id: "user-123",
  metric_slug: "app-launch",
  phase: "complete",
  tracking_id: "tid-1111-1111-1111-111111111111",
  duration_ms: 1250,
  error: null,
  attributes: null,
  environment: "ios",
  os_version: "18.0",
  app_version: "1.0.0",
  device_model: "iPhone 16",
  build_number: "42",
  is_dev: false,
  client_event_id: null,
  timestamp: "2025-01-15T12:00:00.000Z",
  received_at: "2025-01-15T12:00:01.000Z",
};

export const METRIC_DEFINITION: MetricDefinitionResponse = {
  id: "md-1111-1111-1111-111111111111",
  project_id: "p-1111-1111-1111-111111111111",
  name: "App Launch",
  slug: "app-launch",
  description: "Time to launch",
  documentation: null,
  schema_definition: null,
  aggregation_rules: null,
  status: "active",
  created_at: "2025-01-15T10:00:00.000Z",
  updated_at: "2025-01-15T10:00:00.000Z",
};

export const FUNNEL_DEFINITION: FunnelDefinitionResponse = {
  id: "fd-1111-1111-1111-111111111111",
  project_id: "p-1111-1111-1111-111111111111",
  name: "Onboarding",
  slug: "onboarding",
  description: "New user onboarding flow",
  steps: [
    { name: "signup", event_filter: { message: "track:signup" } },
    { name: "profile", event_filter: { message: "track:profile" } },
  ],
  created_at: "2025-01-15T10:00:00.000Z",
  updated_at: "2025-01-15T10:00:00.000Z",
};

export const APP_USER: AppUserResponse = {
  id: "au-1111-1111-1111-111111111111",
  app_id: "a-1111-1111-1111-111111111111",
  user_id: "user-123",
  is_anonymous: false,
  claimed_from: null,
  first_seen_at: "2025-01-15T10:00:00.000Z",
  last_seen_at: "2025-01-15T12:00:00.000Z",
};

export const AUDIT_LOG: AuditLogResponse = {
  id: "al-1111-1111-1111-111111111111",
  team_id: "t-1111-1111-1111-111111111111",
  actor_type: "user",
  actor_id: "u-1111-1111-1111-111111111111",
  action: "create",
  resource_type: "project",
  resource_id: "p-1111-1111-1111-111111111111",
  changes: null,
  metadata: null,
  timestamp: "2025-01-15T10:00:00.000Z",
};

export const PROJECT_DETAIL: ProjectDetailResponse = {
  ...PROJECT,
  apps: [APP],
};

export const PROJECT_DETAIL_NO_APPS: ProjectDetailResponse = {
  ...PROJECT,
  apps: [],
};
