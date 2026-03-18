export const API_KEY_PREFIX = {
  client: "owl_client_",
  agent: "owl_agent_",
} as const;

export const LOG_LEVELS = [
  "info",
  "debug",
  "warn",
  "error",
  "attention",
] as const;

export const MAX_BATCH_SIZE = 100;
export const MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH = 200;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const APP_PLATFORMS = ["apple", "android", "web", "backend"] as const;
export const ENVIRONMENTS = ["ios", "ipados", "macos", "android", "web", "backend"] as const;

export const SLUG_REGEX = /^[a-z0-9-]+$/;

export const PG_UNIQUE_VIOLATION = "23505";
