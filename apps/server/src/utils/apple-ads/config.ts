/**
 * Shape of the `project_integrations.config` blob for provider `apple-search-ads`.
 * Mirrors the field definitions in packages/shared/src/integrations.ts — keep in sync.
 *
 * The private key is EC P-256 (prime256v1), PEM-encoded. The customer generates it
 * locally with `openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem`
 * and uploads the matching public key at ads.apple.com → Account Settings → API.
 */
export interface AppleAdsConfig {
  client_id: string;
  team_id: string;
  key_id: string;
  private_key_pem: string;
  org_id: string;
}
