/** Definition of a config field for an integration provider. */
export interface IntegrationConfigField {
  key: string;
  label: string;
  required: boolean;
  /** If true, the value is redacted in API responses (GET /integrations). */
  sensitive: boolean;
  /**
   * If true, the server generates and rotates this value — user-supplied
   * values on POST/PATCH are stripped before validation, and the field is
   * skipped in required-field checks (the server is responsible for it).
   * Combine with `sensitive: true` to hide the value from GET responses,
   * or `sensitive: false` to expose it (e.g. a public key the user needs
   * to copy into a third-party UI).
   */
  serverManaged?: boolean;
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

/** Typed provider ID constants — prefer these over raw string literals. */
export const INTEGRATION_PROVIDER_IDS = {
  REVENUECAT: "revenuecat",
  APPLE_SEARCH_ADS: "apple-search-ads",
  APP_STORE_CONNECT: "app-store-connect",
} as const;

export type IntegrationProviderId =
  (typeof INTEGRATION_PROVIDER_IDS)[keyof typeof INTEGRATION_PROVIDER_IDS];

/**
 * User-supplied ID fields for apple-search-ads. All four must be present
 * (plus the server-managed keypair) for the integration to be considered
 * complete and automatically enabled. Exported from shared so both server
 * and dashboard use the same list and can't drift if we add a fifth ID.
 */
export const APPLE_ADS_USER_CONFIG_KEYS = [
  "client_id",
  "team_id",
  "key_id",
  "org_id",
] as const;
export type AppleAdsUserConfigKey = (typeof APPLE_ADS_USER_CONFIG_KEYS)[number];

/**
 * Required user-supplied fields for app-store-connect. All three must be
 * present for the integration to be considered complete and auto-enabled.
 */
export const APP_STORE_CONNECT_REQUIRED_KEYS = [
  "issuer_id",
  "key_id",
  "private_key_p8",
] as const;
export type AppStoreConnectRequiredKey =
  (typeof APP_STORE_CONNECT_REQUIRED_KEYS)[number];

export const INTEGRATION_PROVIDERS: IntegrationProviderDefinition[] = [
  {
    id: INTEGRATION_PROVIDER_IDS.REVENUECAT,
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
      {
        key: "webhook_secret",
        label: "Webhook Secret",
        required: false,
        sensitive: true,
        serverManaged: true,
        description: "Auto-generated on create and included in the returned webhook_setup block. Used to authenticate inbound RevenueCat webhook calls. Never accepted from user input.",
      },
    ],
  },
  {
    id: INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS,
    name: "Apple Search Ads",
    description:
      "Resolves Apple Search Ads campaign, ad group, keyword, and ad IDs into human-readable names via Apple's Campaign Management API. Complements the AdServices token capture done by the Swift SDK. Setup is two-step: create the integration (Owlmetry generates the keypair and returns a public key), upload that public key to ads.apple.com → Account Settings → API, then save the returned client/team/key IDs + pick your org.",
    // All four user-supplied IDs are `required: false` at the schema level
    // because setup is multi-step — they're filled in incrementally via PATCH
    // as the user moves through the flow. The effective "all four present"
    // requirement to enable the integration is enforced separately by
    // `hasAllAppleAdsUserConfigKeys` (below) on every PATCH.
    configFields: [
      {
        key: "client_id",
        label: "Client ID",
        required: false,
        sensitive: false,
        placeholder: "SEARCHADS.XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
        description: "Apple Ads API client ID. Issued by Apple at ads.apple.com → Account Settings → API after you upload the public key Owlmetry generated. Starts with \"SEARCHADS.\".",
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
      {
        key: "private_key_pem",
        label: "Private Key (PEM)",
        required: false,
        sensitive: true,
        serverManaged: true,
        description: "EC P-256 private key, PEM-encoded. Generated server-side on create; used to sign the JWT client-assertion sent to Apple. Never accepted from user input.",
      },
      {
        key: "public_key_pem",
        label: "Public Key (PEM)",
        required: false,
        sensitive: false,
        serverManaged: true,
        description: "EC P-256 public key, PEM-encoded. Generated server-side on create and shown to the user once so they can upload it at ads.apple.com → Account Settings → User Management → (their API user) → API. Visible (unredacted) in GET responses. Never accepted from user input.",
      },
    ],
  },
  {
    id: INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT,
    name: "App Store Connect",
    description:
      "Pulls Apple App Store reviews via the App Store Connect customerReviews API. Setup: in App Store Connect → Users and Access → Integrations → App Store Connect API, generate an Individual Key with the \"Customer Support\" role (least-privilege for read-only review access). Download the .p8 file and copy the Key ID and Issuer ID. Each Apple Developer account requires its own integration row — keys cannot be shared across accounts.",
    configFields: [
      {
        key: "issuer_id",
        label: "Issuer ID",
        required: true,
        sensitive: false,
        placeholder: "57246542-96fe-1a63-e053-0824d011072a",
        description: "Your team's Issuer ID. Shown at the top of App Store Connect → Users and Access → Integrations → App Store Connect API.",
      },
      {
        key: "key_id",
        label: "Key ID",
        required: true,
        sensitive: false,
        placeholder: "ABC1234567",
        description: "10-character alphanumeric Key ID assigned to the API key when generated. Visible in the keys list immediately after generation, and embedded in the .p8 filename (AuthKey_<KEY_ID>.p8).",
      },
      {
        key: "private_key_p8",
        label: "Private Key (.p8 contents)",
        required: true,
        sensitive: true,
        placeholder: "-----BEGIN PRIVATE KEY-----\\nMIGTAgEAMBMGByqG…\\n-----END PRIVATE KEY-----",
        description: "Paste the full contents of the .p8 file you downloaded from App Store Connect. PKCS#8 PEM (BEGIN PRIVATE KEY) and SEC1 PEM (BEGIN EC PRIVATE KEY) are both accepted. Owlmetry redacts this value after save and never returns it — to rotate, paste a new .p8.",
      },
    ],
  },
];

export const SUPPORTED_PROVIDER_IDS = INTEGRATION_PROVIDERS.map((p) => p.id);

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
  const provider = getProviderDefinition(providerId);
  if (!provider) return { ...config };
  const managed = new Set(provider.configFields.filter((f) => f.serverManaged).map((f) => f.key));
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
 * Server-managed fields are skipped in the required-field check (server owns
 * them) but still count as known keys, so merged configs on PATCH don't
 * trip the unknown-field guard.
 */
export function validateIntegrationConfig(
  providerId: string,
  config: Record<string, unknown>,
): string | null {
  const provider = getProviderDefinition(providerId);
  if (!provider) {
    return `Unsupported integration provider: "${providerId}". Supported: ${SUPPORTED_PROVIDER_IDS.join(", ")}`;
  }

  for (const field of provider.configFields) {
    if (field.serverManaged) continue;
    if (field.required) {
      const value = config[field.key];
      if (value === undefined || value === null || value === "") {
        return `Missing required config field: "${field.key}" (${field.label})`;
      }
    }
  }

  const knownKeys = new Set(provider.configFields.map((f) => f.key));
  const userFacingKeys = provider.configFields.filter((f) => !f.serverManaged).map((f) => f.key);
  for (const key of Object.keys(config)) {
    if (!knownKeys.has(key)) {
      return `Unknown config field: "${key}". Valid fields for ${provider.name}: ${userFacingKeys.join(", ")}`;
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") {
      return `Config field "${key}" must be a string`;
    }
  }

  return null;
}

/**
 * Redact sensitive fields in a config object based on the provider definition.
 * - Unknown provider → redact everything (conservative default).
 * - `sensitive: true` → redact. Applies equally to user-provided secrets
 *   (e.g. `api_key`) and server-managed secrets (e.g. `private_key_pem`).
 * - Anything else → returned as-is.
 */
export function redactIntegrationConfig(
  providerId: string,
  config: Record<string, unknown>,
): Record<string, string> {
  const provider = getProviderDefinition(providerId);
  const sensitiveKeys = new Set(provider?.configFields.filter((f) => f.sensitive).map((f) => f.key) ?? []);

  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    const str = String(value ?? "");
    if (!provider || sensitiveKeys.has(key)) {
      redacted[key] = str.length > 4 ? str.slice(0, 4) + "****" : "****";
    } else {
      redacted[key] = str;
    }
  }
  return redacted;
}

/**
 * True if an apple-search-ads config has all four user-supplied IDs
 * (client, team, key, org). Used by the server to derive `enabled` and by
 * the dashboard to decide whether to show the "Finish setup" card.
 *
 * This predicate intentionally does *not* check for `private_key_pem` or
 * `public_key_pem` — those are server-managed and redacted out of GET
 * responses, so the web client never sees them. On the server side the
 * keypair is always present when the row exists, because it's generated
 * atomically with the integration.
 */
export function hasAllAppleAdsUserConfigKeys(config: Record<string, unknown>): boolean {
  for (const key of APPLE_ADS_USER_CONFIG_KEYS) {
    const value = config[key];
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}

/**
 * True if an app-store-connect config has all three required fields
 * (issuer_id, key_id, private_key_p8). Drives `enabled` derivation on
 * POST/PATCH the same way `hasAllAppleAdsUserConfigKeys` does for ASA.
 */
export function hasAllAppStoreConnectConfigKeys(config: Record<string, unknown>): boolean {
  for (const key of APP_STORE_CONNECT_REQUIRED_KEYS) {
    const value = config[key];
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}
