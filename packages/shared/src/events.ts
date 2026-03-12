export type LogLevel =
  | "info"
  | "debug"
  | "warn"
  | "error"
  | "attention"
  | "tracking";

export type Platform = "ios" | "ipados" | "macos" | "android" | "web";

export interface EventPayload {
  client_event_id?: string;
  user_identifier?: string;
  level: LogLevel;
  source?: string;
  body: string;
  context?: string;
  meta?: Record<string, string>;
  platform?: Platform;
  os_version?: string;
  app_version?: string;
  build_number?: string;
  device_model?: string;
  locale?: string;
  timestamp?: string; // ISO 8601
}

export interface NormalizedEvent {
  id: string;
  app_id: string;
  user_identifier: string | null;
  level: LogLevel;
  source: string | null;
  body: string;
  context: string | null;
  meta: Record<string, string> | null;
  platform: Platform | null;
  os_version: string | null;
  app_version: string | null;
  build_number: string | null;
  device_model: string | null;
  locale: string | null;
  timestamp: Date;
  received_at: Date;
  solved: boolean;
}

export interface IngestRequest {
  events: EventPayload[];
}

export interface IngestResponse {
  accepted: number;
  rejected: number;
  errors?: Array<{ index: number; message: string }>;
}
