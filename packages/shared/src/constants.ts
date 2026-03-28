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

export const ALLOWED_ENVIRONMENTS_FOR_PLATFORM: Record<
  (typeof APP_PLATFORMS)[number],
  readonly (typeof ENVIRONMENTS)[number][]
> = {
  apple: ["ios", "ipados", "macos"],
  android: ["android"],
  web: ["web"],
  backend: ["backend"],
};

export const SLUG_REGEX = /^[a-z0-9-]+$/;

/**
 * Validate a slug (metric, funnel, etc.). Slugs must contain only lowercase
 * letters, numbers, and hyphens (e.g. "photo-conversion", "onboarding").
 * Returns null if valid, or an error message string if invalid.
 */
export function validateSlug(slug: string, label = "slug"): string | null {
  if (!slug) return `${label} is required`;
  if (!SLUG_REGEX.test(slug)) {
    return `${label} must contain only lowercase letters, numbers, and hyphens (e.g. "onboarding")`;
  }
  return null;
}

export function validateMetricSlug(slug: string): string | null {
  return validateSlug(slug, "metric slug");
}

export function validateFunnelSlug(slug: string): string | null {
  return validateSlug(slug, "funnel slug");
}

/**
 * Format a duration in milliseconds to a human-readable string.
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

export const MAX_USER_PROPERTY_KEY_LENGTH = 50;
export const MAX_USER_PROPERTY_VALUE_LENGTH = 200;
export const MAX_USER_PROPERTIES_COUNT = 50;

export const PG_UNIQUE_VIOLATION = "23505";
