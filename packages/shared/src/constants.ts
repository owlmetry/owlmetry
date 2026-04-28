export const API_KEY_PREFIX = {
  client: "owl_client_",
  agent: "owl_agent_",
  import: "owl_import_",
} as const;

export const LOG_LEVELS = [
  "info",
  "debug",
  "warn",
  "error",
] as const;

export const MAX_BATCH_SIZE = 100;
export const MAX_IMPORT_BATCH_SIZE = 1000;
export const MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH = 200;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const APP_PLATFORMS = ["apple", "android", "web", "backend"] as const;
export const ENVIRONMENTS = ["ios", "ipados", "macos", "android", "web", "backend"] as const;

/**
 * Platforms a registered push device (`user_devices.platform`) can be on. The
 * mobile_push adapter routes per-row by this field — iOS goes through APNs
 * today, Android is reserved for the FCM transport that will land later.
 * Distinct from `APP_PLATFORMS` (which classifies an app's broad surface) and
 * from `ENVIRONMENTS` (which records the OS an event was emitted from).
 */
export const DEVICE_PLATFORMS = ["ios", "android"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

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
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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

// App Store Connect's hard limit on a developer response body.
export const MAX_REVIEW_RESPONSE_LENGTH = 5970;

export const PG_UNIQUE_VIOLATION = "23505";

// Data retention defaults (in days)
export const DEFAULT_RETENTION_DAYS_EVENTS = 120;
export const DEFAULT_RETENTION_DAYS_METRICS = 365;
export const DEFAULT_RETENTION_DAYS_FUNNELS = 365;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

export const DEFAULT_ATTACHMENT_USER_QUOTA_BYTES = 250 * 1024 * 1024;
export const DEFAULT_ATTACHMENT_PROJECT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
export const MIN_ATTACHMENT_USER_QUOTA_BYTES = 1024 * 1024;
export const MAX_ATTACHMENT_USER_QUOTA_BYTES = 1024 * 1024 * 1024 * 1024;
export const MIN_ATTACHMENT_PROJECT_QUOTA_BYTES = 1024 * 1024;
export const MAX_ATTACHMENT_PROJECT_QUOTA_BYTES = 1024 * 1024 * 1024 * 1024;
export const ATTACHMENT_ORPHAN_GRACE_HOURS = 24;
export const ATTACHMENT_SOFT_DELETE_GRACE_DAYS = 7;
export const ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS = 60;
export const ATTACHMENT_UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const ATTACHMENT_MAX_FILENAME_LENGTH = 255;
export const ATTACHMENT_ORPHAN_SWEEP_BATCH_SIZE = 5000;
export const ATTACHMENT_ISSUE_DETAIL_PAGE_SIZE = 100;
export const DEFAULT_BINARY_CONTENT_TYPE = "application/octet-stream";

// Denylist rather than allowlist: debug files are often weird formats (.usdz, .heic,
// custom binary) and an allowlist would block legitimate attachments. Downloads always
// set Content-Disposition: attachment so browsers never auto-execute.
export const ATTACHMENT_CONTENT_TYPE_DENYLIST: readonly string[] = [
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-msi",
  "application/x-executable",
  "application/x-mach-binary",
  "application/x-sharedlib",
  "application/vnd.microsoft.portable-executable",
  "application/x-dosexec",
  "application/x-shellscript",
  "application/x-sh",
  "text/x-shellscript",
  "application/x-python-code",
  "application/java-archive",
  "application/x-java-archive",
  "application/vnd.apple.installer+xml",
];

export function isDisallowedAttachmentContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  return ATTACHMENT_CONTENT_TYPE_DENYLIST.includes(normalized);
}
