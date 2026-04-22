/** Definition of a config field for an integration provider. */
export interface IntegrationConfigField {
  key: string;
  label: string;
  required: boolean;
  sensitive: boolean; // if true, value is redacted in API responses
  placeholder?: string;
  description?: string;
}

/** Definition of a supported integration provider. */
export interface IntegrationProviderDefinition {
  id: string;
  name: string;
  description: string;
  configFields: IntegrationConfigField[];
}

export const INTEGRATION_PROVIDERS: IntegrationProviderDefinition[] = [
  {
    id: "revenuecat",
    name: "RevenueCat",
    description: "Subscription management — syncs subscriber status, revenue, and entitlements to user properties.",
    configFields: [
      {
        key: "api_key",
        label: "Secret API Key",
        required: true,
        sensitive: true,
        placeholder: "sk_...",
        description: "RevenueCat V2 Secret API key. Generate in RevenueCat dashboard → Project Settings → API Keys → + New secret API key. Required permissions — set at the section level (top-right dropdown on each section), not per individual sub-row: Customer information → Read only AND Project configuration → Read only. All other sections → No access.",
      },
    ],
  },
  {
    id: "apple-search-ads",
    name: "Apple Search Ads",
    description:
      "Resolves Apple Search Ads campaign, ad group, keyword, and ad IDs into human-readable names via Apple's Campaign Management API. Complements the AdServices token capture done by the Swift SDK. Setup is two-step: create the integration (OwlMetry generates the keypair and returns a public key), upload that public key to ads.apple.com → Account Settings → API, then save the returned client/team/key IDs + pick your org.",
    configFields: [
      {
        key: "client_id",
        label: "Client ID",
        required: false,
        sensitive: false,
        placeholder: "SEARCHADS.XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
        description: "Apple Ads API client ID. Issued by Apple at ads.apple.com → Account Settings → API after you upload the public key OwlMetry generated. Starts with \"SEARCHADS.\".",
      },
      {
        key: "team_id",
        label: "Team ID",
        required: false,
        sensitive: false,
        placeholder: "SEARCHADS.XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
        description: "Apple Ads API team ID. Issued alongside the client ID. Also prefixed \"SEARCHADS.\".",
      },
      {
        key: "key_id",
        label: "Key ID",
        required: false,
        sensitive: false,
        placeholder: "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
        description: "Apple Ads API key ID. Issued alongside the client/team IDs when you upload the public key.",
      },
      {
        key: "org_id",
        label: "Org ID (Account ID)",
        required: false,
        sensitive: false,
        placeholder: "40669820",
        description: "Apple Ads campaign-group ID — shown as \"Account ID\" in ads.apple.com (click your name in the top-right, the number under your org). Apple calls this orgId in the API. Also retrievable via GET /api/v5/acls once the other credentials are set.",
      },
    ],
  },
];

export const SUPPORTED_PROVIDER_IDS = INTEGRATION_PROVIDERS.map((p) => p.id);

/**
 * Per-provider config keys managed entirely server-side. The server generates
 * and rotates these; user-supplied values on POST/PATCH are always stripped
 * before validation. Keep `redactIntegrationConfig` aware of them so GET
 * responses don't leak the values (except any listed in
 * `SERVER_MANAGED_VISIBLE_KEYS`, which the user explicitly needs to copy —
 * e.g. a public key to upload to a third-party provider).
 */
export const SERVER_MANAGED_CONFIG_KEYS: Record<string, readonly string[]> = {
  revenuecat: ["webhook_secret"],
  "apple-search-ads": ["private_key_pem", "public_key_pem"],
};

/** Server-managed keys that should still be visible (unredacted) in GET responses. */
export const SERVER_MANAGED_VISIBLE_KEYS: Record<string, readonly string[]> = {
  "apple-search-ads": ["public_key_pem"],
};

/** Look up a provider definition by ID. Returns undefined if not supported. */
export function getProviderDefinition(providerId: string): IntegrationProviderDefinition | undefined {
  return INTEGRATION_PROVIDERS.find((p) => p.id === providerId);
}

/**
 * Remove server-managed keys from an inbound user-supplied config. Call this
 * before validation on POST/PATCH so callers can't inject values like a
 * private key or webhook secret — the server generates those itself.
 */
export function stripServerManagedKeys(providerId: string, config: Record<string, unknown>): Record<string, unknown> {
  const managed = new Set(SERVER_MANAGED_CONFIG_KEYS[providerId] ?? []);
  if (managed.size === 0) return { ...config };
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (!managed.has(key)) stripped[key] = value;
  }
  return stripped;
}

/**
 * Validate a config object against a provider's field definitions.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateIntegrationConfig(
  providerId: string,
  config: Record<string, unknown>,
): string | null {
  const provider = getProviderDefinition(providerId);
  if (!provider) {
    return `Unsupported integration provider: "${providerId}". Supported: ${SUPPORTED_PROVIDER_IDS.join(", ")}`;
  }

  // Check required fields
  for (const field of provider.configFields) {
    if (field.required) {
      const value = config[field.key];
      if (value === undefined || value === null || value === "") {
        return `Missing required config field: "${field.key}" (${field.label})`;
      }
    }
  }

  // Check for unknown fields. Server-managed keys (private_key_pem,
  // webhook_secret, etc.) are tolerated because merged configs in the
  // update path include them from the stored row, even though users can't
  // set them directly (stripServerManagedKeys removes inbound values).
  const knownKeys = new Set(provider.configFields.map((f) => f.key));
  const managedKeys = new Set(SERVER_MANAGED_CONFIG_KEYS[providerId] ?? []);
  for (const key of Object.keys(config)) {
    if (!knownKeys.has(key) && !managedKeys.has(key)) {
      return `Unknown config field: "${key}". Valid fields for ${provider.name}: ${[...knownKeys].join(", ")}`;
    }
  }

  // Validate all values are strings
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") {
      return `Config field "${key}" must be a string`;
    }
  }

  return null;
}

/**
 * Redact sensitive fields in a config object based on the provider definition.
 *
 * Redaction rules:
 * - Unknown provider → redact everything (conservative default).
 * - `configField.sensitive: true` (user-provided sensitive, e.g. `api_key`) → redact.
 * - `SERVER_MANAGED_CONFIG_KEYS[provider]` → redact, *unless* also listed in
 *   `SERVER_MANAGED_VISIBLE_KEYS[provider]` (e.g. the Apple Ads public key the
 *   user still needs to copy out of the dashboard).
 * - Anything else → returned as-is.
 */
export function redactIntegrationConfig(
  providerId: string,
  config: Record<string, unknown>,
): Record<string, string> {
  const provider = getProviderDefinition(providerId);
  const sensitiveKeys = new Set(provider?.configFields.filter((f) => f.sensitive).map((f) => f.key) ?? []);
  const managedKeys = new Set(SERVER_MANAGED_CONFIG_KEYS[providerId] ?? []);
  const visibleManagedKeys = new Set(SERVER_MANAGED_VISIBLE_KEYS[providerId] ?? []);

  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    const str = String(value ?? "");
    const isUserSensitive = sensitiveKeys.has(key);
    const isHiddenManaged = managedKeys.has(key) && !visibleManagedKeys.has(key);
    if (!provider || isUserSensitive || isHiddenManaged) {
      redacted[key] = str.length > 4 ? str.slice(0, 4) + "****" : "****";
    } else {
      redacted[key] = str;
    }
  }
  return redacted;
}
