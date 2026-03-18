export type LogLevel =
  | "info"
  | "debug"
  | "warn"
  | "error";

export type AppPlatform = "apple" | "android" | "web" | "backend";
export type Environment = "ios" | "ipados" | "macos" | "android" | "web" | "backend";

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
  build_number?: string;
  device_model?: string;
  locale?: string;
  is_debug?: boolean;
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
  build_number: string | null;
  device_model: string | null;
  locale: string | null;
  is_debug: boolean;
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
