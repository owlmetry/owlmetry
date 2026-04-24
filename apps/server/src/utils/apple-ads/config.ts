/**
 * OAuth credentials for Apple's token endpoint — enough to mint an access
 * token and call `/acls` (which is scoped to the credentials, not an org).
 * The private key is EC P-256 (prime256v1), PEM-encoded. Owlmetry generates
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
