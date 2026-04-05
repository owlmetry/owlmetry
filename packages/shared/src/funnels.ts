// ── Funnel Definitions ─────────────────────────────────────────────────

export interface FunnelStepFilter {
  step_name?: string;
  screen_name?: string;
}

export interface FunnelStep {
  name: string;
  event_filter: FunnelStepFilter;
}

export interface FunnelDefinition {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description: string | null;
  steps: FunnelStep[];
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

// ── Analytics ──────────────────────────────────────────────────────────

export interface FunnelStepAnalytics {
  step_index: number;
  step_name: string;
  unique_users: number;
  percentage: number;
  drop_off_count: number;
  drop_off_percentage: number;
}

export interface FunnelAnalytics {
  funnel: FunnelDefinitionResponse;
  mode: "closed" | "open";
  total_users: number;
  steps: FunnelStepAnalytics[];
  breakdown?: FunnelBreakdownGroup[];
}

export interface FunnelBreakdownGroup {
  key: string;
  value: string;
  total_users: number;
  steps: FunnelStepAnalytics[];
}

// ── Serialized response type ───────────────────────────────────────────

export type FunnelDefinitionResponse = Omit<FunnelDefinition, "created_at" | "updated_at" | "deleted_at"> & {
  created_at: string;
  updated_at: string;
};

// ── Step Message Helpers ──────────────────────────────────────────────

export const STEP_MESSAGE_PREFIX = "step:";

export function buildStepMessage(stepName: string): string {
  return `${STEP_MESSAGE_PREFIX}${stepName}`;
}

function parsePrefixedMessage(message: string, prefix: string): string | null {
  if (!message.startsWith(prefix)) return null;
  const body = message.slice(prefix.length);
  return body || null;
}

export function parseStepMessage(message: string): string | null {
  return parsePrefixedMessage(message, STEP_MESSAGE_PREFIX);
}

/**
 * Parse a funnel step message that may use either the new "step:" prefix or the
 * legacy "track:" prefix. Existing clients in the wild still send "track:" — this
 * function accepts both so the server can process events from old and new SDKs.
 * The "track:" prefix is temporary and will be removed in a future version.
 */
export function parseFunnelStepMessage(message: string): string | null {
  return parseStepMessage(message) ?? parseTrackMessage(message);
}

// ── Legacy (deprecated — remove after all clients migrate to step:) ──

/** @deprecated Use STEP_MESSAGE_PREFIX instead. Will be removed in a future version. */
export const TRACK_MESSAGE_PREFIX = "track:";

/** @deprecated Use buildStepMessage instead. Will be removed in a future version. */
export function buildTrackMessage(stepName: string): string {
  return `${TRACK_MESSAGE_PREFIX}${stepName}`;
}

/** @deprecated Use parseFunnelStepMessage (for server) or parseStepMessage (for new code). Will be removed in a future version. */
export function parseTrackMessage(message: string): string | null {
  return parsePrefixedMessage(message, TRACK_MESSAGE_PREFIX);
}
