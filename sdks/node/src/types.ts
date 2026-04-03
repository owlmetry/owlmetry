export type OwlLogLevel = "info" | "debug" | "warn" | "error";

export interface OwlConfiguration {
  /** OwlMetry server endpoint URL */
  endpoint: string;
  /** Client API key for a server-platform app (must start with owl_client_) */
  apiKey: string;
  /** Service name for logging/debugging (not sent as bundle_id) */
  serviceName?: string;
  /** Application version */
  appVersion?: string;
  /** Enable debug logging to console.error */
  debug?: boolean;
  /** Flush interval in milliseconds (default: 5000) */
  flushIntervalMs?: number;
  /** Max events to buffer before auto-flush (default: 20) */
  flushThreshold?: number;
  /** Max events in buffer before dropping oldest (default: 10000) */
  maxBufferSize?: number;
  /** Mark events as development builds. Defaults to `process.env.NODE_ENV !== "production"` */
  isDev?: boolean;
  /** Print events to console. Defaults to true. */
  consoleLogging?: boolean;
}

export interface LogEvent {
  client_event_id: string;
  session_id: string;
  user_id?: string;
  level: OwlLogLevel;
  source_module?: string;
  message: string;
  custom_attributes?: Record<string, string>;
  experiments?: Record<string, string>;
  environment: "backend";
  app_version?: string;
  is_dev?: boolean;
  timestamp: string;
}

export interface IngestRequest {
  events: LogEvent[];
}

export interface IngestResponse {
  accepted: number;
  rejected: number;
  errors?: Array<{ index: number; message: string }>;
}
