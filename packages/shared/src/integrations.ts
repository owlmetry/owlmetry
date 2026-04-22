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
      "Resolves Apple Search Ads campaign, ad group, keyword, and ad IDs into human-readable names via Apple's Campaign Management API. Complements the AdServices token capture done by the Swift SDK.",
    configFields: [
      {
        key: "client_id",
        label: "Client ID",
        required: true,
        sensitive: false,
        placeholder: "SEARCHADS.XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
        description: "Apple Ads API client ID. Generated at ads.apple.com → Account Settings → API after you upload a public key. Starts with \"SEARCHADS.\".",
      },
      {
        key: "team_id",
        label: "Team ID",
        required: true,
        sensitive: false,
        placeholder: "SEARCHADS.XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
        description: "Apple Ads API team ID. Issued alongside the client ID at ads.apple.com → Account Settings → API. Also prefixed \"SEARCHADS.\".",
      },
      {
        key: "key_id",
        label: "Key ID",
        required: true,
        sensitive: false,
        placeholder: "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
        description: "Apple Ads API key ID. Issued alongside the client/team IDs when you upload your public key.",
      },
      {
        key: "private_key_pem",
        label: "Private Key (PEM)",
        required: true,
        sensitive: true,
        placeholder: "-----BEGIN EC PRIVATE KEY-----\n...",
        description: "EC P-256 private key, PEM-encoded. Generate locally with: openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem. Upload the matching public key at ads.apple.com → Account Settings → API, then paste the private key here.",
      },
      {
        key: "org_id",
        label: "Org ID",
        required: true,
        sensitive: false,
        placeholder: "40669820",
        description: "Apple Ads campaign-group ID. Find it in ads.apple.com (top-right account switcher) or by hitting GET /api/v5/acls once your credentials are set up.",
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

  // Check for unknown fields
  const knownKeys = new Set(provider.configFields.map((f) => f.key));
  for (const key of Object.keys(config)) {
    if (!knownKeys.has(key)) {
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
 * Non-sensitive fields are returned as-is. Unknown providers return all values redacted.
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
    if (sensitiveKeys.has(key) || !provider) {
      redacted[key] = str.length > 4 ? str.slice(0, 4) + "****" : "****";
    } else {
      redacted[key] = str;
    }
  }
  return redacted;
}
