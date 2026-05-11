export type LogLevel =
  | "info"
  | "debug"
  | "warn"
  | "error";

export type AppPlatform = "apple" | "android" | "web" | "backend";
export type Environment = "ios" | "ipados" | "macos" | "watchos" | "android" | "web" | "backend";

// SDK-emitted event message names + their custom_attributes keys. Mirrored by
// the Swift SDK's URLSessionInstrumentation. Server consumers (notably issue
// fingerprinting) read these to apply per-event-name behavior.
export const NETWORK_REQUEST_MESSAGE = "sdk:network_request";
export const HTTP_URL_ATTRIBUTE = "_http_url";
export const HTTP_METHOD_ATTRIBUTE = "_http_method";

// Error/exception extraction attributes. SDKs that accept an Error/Exception
// object (Owl.error(error)) extract structured data into these reserved keys.
// _error_type also acts as the issue-fingerprint discriminator so two error
// classes with identical messages stay on separate issues.
export const ERROR_TYPE_ATTRIBUTE = "_error_type";
export const ERROR_STACK_ATTRIBUTE = "_error_stack";
export const ERROR_CODE_ATTRIBUTE = "_error_code";
export const ERROR_DOMAIN_ATTRIBUTE = "_error_domain";
export const ERROR_ERRNO_ATTRIBUTE = "_error_errno";
export const ERROR_SYSCALL_ATTRIBUTE = "_error_syscall";
export const ERROR_PATH_ATTRIBUTE = "_error_path";
export const ERROR_AGGREGATE_COUNT_ATTRIBUTE = "_error_aggregate_count";
export const ERROR_AGGREGATE_FIRST_TYPE_ATTRIBUTE = "_error_aggregate_first_type";
export const ERROR_AGGREGATE_FIRST_MESSAGE_ATTRIBUTE = "_error_aggregate_first_message";
export const UNHANDLED_ATTRIBUTE = "_unhandled";

export const ERROR_CAUSE_MAX_DEPTH = 5;
export function errorCauseTypeKey(depth: number): string {
  return `_error_cause_${depth}_type`;
}
export function errorCauseMessageKey(depth: number): string {
  return `_error_cause_${depth}_message`;
}

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
