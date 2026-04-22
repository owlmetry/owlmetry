/**
 * OAuth credentials for Apple's token endpoint — enough to mint an access
 * token and call `/acls` (which is scoped to the credentials, not an org).
 * The private key is EC P-256 (prime256v1), PEM-encoded. The customer
 * generates it locally with `openssl ecparam -genkey -name prime256v1 -noout
 * -out private-key.pem` and uploads the matching public key at
 * ads.apple.com → Account Settings → API.
 */
export interface AppleAdsAuthConfig {
  client_id: string;
  team_id: string;
  key_id: string;
  private_key_pem: string;
}

/**
 * Full shape of the `project_integrations.config` blob for provider
 * `apple-search-ads`. Adds `org_id` to the auth config — required by every
 * Campaign Management endpoint except `/acls`. Mirrors the field definitions
 * in packages/shared/src/integrations.ts — keep in sync.
 */
export interface AppleAdsConfig extends AppleAdsAuthConfig {
  org_id: string;
}
