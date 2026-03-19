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

export const PG_UNIQUE_VIOLATION = "23505";
