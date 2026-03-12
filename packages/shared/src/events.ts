export type LogLevel =
  | "info"
  | "debug"
  | "warn"
  | "error"
  | "attention"
  | "tracking";

export interface DeviceInfo {
  model?: string;
  os?: string;
  osVersion?: string;
  appVersion?: string;
  buildNumber?: string;
  locale?: string;
  platform?: "ios" | "ipados" | "macos" | "android" | "web";
}

export interface EventPayload {
  client_event_id?: string;
  user_identifier?: string;
  level: LogLevel;
  source?: string;
  body: string;
  context?: string;
  meta?: Record<string, string>;
  device_info?: DeviceInfo;
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
  device_info: DeviceInfo | null;
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
