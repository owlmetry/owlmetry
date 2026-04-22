/**
 * OAuth credentials for Apple's token endpoint — enough to mint an access
 * token and call `/acls` (which is scoped to the credentials, not an org).
 * The private key is EC P-256 (prime256v1), PEM-encoded. OwlMetry generates
 * the keypair server-side via `generateAppleAdsKeypair()`; the customer
 * uploads the matching public key at ads.apple.com → Account Settings → API
 * to get the other three IDs.
 */
export interface AppleAdsAuthConfig {
  client_id: string;
  team_id: string;
  key_id: string;
  private_key_pem: string;
}

/**
 * Full shape of the `project_integrations.config` blob for provider
 * `apple-search-ads` once a user has completed setup. Adds `org_id`
 * (required by every Campaign Management endpoint except `/acls`) and
 * `public_key_pem` (kept so the dashboard can re-surface it if the user
 * needs to re-upload to Apple).
 */
export interface AppleAdsConfig extends AppleAdsAuthConfig {
  org_id: string;
  public_key_pem: string;
}

/**
 * Partial config used while setup is still in progress. The server generates
 * `private_key_pem` + `public_key_pem` when the integration row is first
 * created; the four IDs are filled in incrementally as the user completes
 * steps. All four must be present (and the integration `enabled=true`)
 * before Campaign Management API calls can run.
 */
export interface PendingAppleAdsConfig {
  client_id?: string;
  team_id?: string;
  key_id?: string;
  org_id?: string;
  private_key_pem: string;
  public_key_pem: string;
}

/** All four user-supplied ID fields that must be present for the integration to be fully configured. */
export const APPLE_ADS_USER_CONFIG_KEYS = ["client_id", "team_id", "key_id", "org_id"] as const;
export type AppleAdsUserConfigKey = (typeof APPLE_ADS_USER_CONFIG_KEYS)[number];

/** True if the given config has all four IDs filled in (i.e. ready for API calls). */
export function isAppleAdsConfigComplete(config: Record<string, unknown>): boolean {
  if (typeof config.private_key_pem !== "string" || config.private_key_pem.length === 0) return false;
  if (typeof config.public_key_pem !== "string" || config.public_key_pem.length === 0) return false;
  for (const key of APPLE_ADS_USER_CONFIG_KEYS) {
    const value = config[key];
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}
