// ── Metric Definitions ─────────────────────────────────────────────────

export interface MetricSchemaField {
  name: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  description?: string;
}

export interface MetricSchemaDefinition {
  /** Fields expected on start phase */
  start_fields?: MetricSchemaField[];
  /** Fields expected on complete phase */
  complete_fields?: MetricSchemaField[];
  /** Fields expected on record (single-shot) phase */
  fields?: MetricSchemaField[];
}

export interface MetricAggregationRules {
  /** Attribute key to use as the primary duration field (default: duration_ms) */
  duration_field?: string;
  /** Attribute key to treat as a size metric for aggregation */
  size_field?: string;
  /** Attribute keys to group errors by */
  error_group_fields?: string[];
  /** Whether this metric has start/complete/fail/cancel lifecycle phases */
  lifecycle: boolean;
}

export interface MetricDefinition {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description: string | null;
  documentation: string | null;
  schema_definition: MetricSchemaDefinition | null;
  aggregation_rules: MetricAggregationRules | null;
  status: "active" | "paused";
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

// ── Metric Events ──────────────────────────────────────────────────────

export type MetricPhase = "start" | "complete" | "fail" | "cancel" | "record";

export const METRIC_PHASES: MetricPhase[] = ["start", "complete", "fail", "cancel", "record"];

export interface StoredMetricEvent {
  id: string;
  app_id: string;
  session_id: string;
  user_id: string | null;
  metric_slug: string;
  phase: MetricPhase;
  tracking_id: string | null;
  duration_ms: number | null;
  error: string | null;
  attributes: Record<string, string> | null;
  environment: string | null;
  os_version: string | null;
  app_version: string | null;
  device_model: string | null;
  build_number: string | null;
  is_debug: boolean;
  client_event_id: string | null;
  timestamp: Date;
  received_at: Date;
}

// ── Message Helpers ────────────────────────────────────────────────────

export const METRIC_MESSAGE_PREFIX = "metric:";

/**
 * Parse a metric message like "metric:photo-conversion:start" into its parts.
 * Returns null if the message doesn't match the metric pattern.
 */
export function parseMetricMessage(message: string): { slug: string; phase: MetricPhase } | null {
  if (!message.startsWith(METRIC_MESSAGE_PREFIX)) return null;

  const rest = message.slice(METRIC_MESSAGE_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon === -1) return null;

  const slug = rest.slice(0, lastColon);
  const phase = rest.slice(lastColon + 1);

  // Slug must be non-empty and contain only lowercase letters, numbers, and hyphens
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  if (!METRIC_PHASES.includes(phase as MetricPhase)) return null;

  return { slug, phase: phase as MetricPhase };
}

/**
 * Build a metric message string from slug and phase.
 */
export function buildMetricMessage(slug: string, phase: MetricPhase): string {
  return `${METRIC_MESSAGE_PREFIX}${slug}:${phase}`;
}
