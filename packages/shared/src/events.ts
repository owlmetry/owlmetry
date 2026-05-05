export type LogLevel =
  | "info"
  | "debug"
  | "warn"
  | "error";

export type AppPlatform = "apple" | "android" | "web" | "backend";
export type Environment = "ios" | "ipados" | "macos" | "android" | "web" | "backend";

// SDK-emitted event message names + their custom_attributes keys. Mirrored by
// the Swift SDK's URLSessionInstrumentation. Server consumers (notably issue
// fingerprinting) read these to apply per-event-name behavior.
export const NETWORK_REQUEST_MESSAGE = "sdk:network_request";
export const HTTP_URL_ATTRIBUTE = "_http_url";
export const HTTP_METHOD_ATTRIBUTE = "_http_method";

export interface IngestEventPayload {
  client_event_id?: string;
  session_id: string;
  user_id?: string;
  level: LogLevel;
  source_module?: string;
  message: string;
  screen_name?: string;
  custom_attributes?: Record<string, string>;
  environment?: Environment;
  os_version?: string;
  app_version?: string;
  sdk_name?: string;
  sdk_version?: string;
  build_number?: string;
  device_model?: string;
  locale?: string;
  is_dev?: boolean;
  experiments?: Record<string, string>;
  timestamp?: string; // ISO 8601
}

export interface StoredEvent {
  id: string;
  app_id: string;
  session_id: string;
  user_id: string | null;
  level: LogLevel;
  source_module: string | null;
  message: string;
  screen_name: string | null;
  custom_attributes: Record<string, string> | null;
  environment: Environment | null;
  os_version: string | null;
  app_version: string | null;
  sdk_name: string | null;
  sdk_version: string | null;
  build_number: string | null;
  device_model: string | null;
  locale: string | null;
  country_code: string | null;
  is_dev: boolean;
  experiments: Record<string, string> | null;
  timestamp: Date;
  received_at: Date;
}

export interface IngestRequest {
  bundle_id?: string;
  events: IngestEventPayload[];
}

export interface IngestResponse {
  accepted: number;
  rejected: number;
  errors?: Array<{ index: number; message: string }>;
}
