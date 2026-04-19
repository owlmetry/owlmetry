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
        description: "RevenueCat V2 Secret API key. Generate in RevenueCat dashboard → Project Settings → API Keys → + New secret API key. Required permissions: Customer information → Customers Configuration → Read only AND Project configuration → Projects Configuration → Read only. All other sections → No access.",
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
