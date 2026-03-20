export const API_KEY_PREFIX = {
  client: "owl_client_",
  agent: "owl_agent_",
} as const;

export const LOG_LEVELS = [
  "info",
  "debug",
  "warn",
  "error",
] as const;

export const MAX_BATCH_SIZE = 100;
export const MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH = 200;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const APP_PLATFORMS = ["apple", "android", "web", "backend"] as const;
export const ENVIRONMENTS = ["ios", "ipados", "macos", "android", "web", "backend"] as const;

export const SLUG_REGEX = /^[a-z0-9-]+$/;

/**
 * Validate a metric slug. Slugs must contain only lowercase letters, numbers,
 * and hyphens (e.g. "photo-conversion", "api-request", "onboarding").
 * Returns null if valid, or an error message string if invalid.
 */
export function validateMetricSlug(slug: string): string | null {
  if (!slug) return "metric slug is required";
  if (!SLUG_REGEX.test(slug)) {
    return "metric slug must contain only lowercase letters, numbers, and hyphens (e.g. \"photo-conversion\")";
  }
  return null;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * < 1ms → "0.12ms", 1–999ms → "123ms", 1–59.99s → "3.1s",
 * 1–59.99min → "2m 15s", ≥ 1h → "1h 23m"
 */
export function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export const PG_UNIQUE_VIOLATION = "23505";
