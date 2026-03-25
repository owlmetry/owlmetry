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

// ── Track Message Helpers ──────────────────────────────────────────────

export const TRACK_MESSAGE_PREFIX = "track:";

export function buildTrackMessage(stepName: string): string {
  return `${TRACK_MESSAGE_PREFIX}${stepName}`;
}

export function parseTrackMessage(message: string): string | null {
  if (!message.startsWith(TRACK_MESSAGE_PREFIX)) return null;
  const stepName = message.slice(TRACK_MESSAGE_PREFIX.length);
  return stepName || null;
}
