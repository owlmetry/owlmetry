/**
 * APNs (Apple Push Notification service) auth + delivery config.
 *
 * Single Apple Developer account → single set of env vars. Token-based auth
 * (.p8 key) reuses the same ES256 / EC P-256 pattern Apple uses everywhere
 * (App Store Connect API, Apple Search Ads, Sign in with Apple).
 *
 * If `APNS_KEY_P8` is unset the iOS push adapter logs once at boot and marks
 * every push delivery `skipped` — this keeps dev / local environments working
 * without push setup.
 *
 * Sandbox vs production routing is per-device — the iOS client tells the
 * server which APNs environment its token belongs to at registration time
 * and the server picks the matching host on each push. No server-wide flag.
 */
export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** Full PEM contents of the .p8 key downloaded from Apple Developer. */
  keyPem: string;
  /** Bundle id of the iOS app. Used as `apns-topic`. */
  bundleId: string;
}

export function loadApnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const keyPem = env.APNS_KEY_P8?.trim();
  const bundleId = env.APNS_BUNDLE_ID?.trim();
  if (!keyId || !teamId || !keyPem || !bundleId) return null;
  return { keyId, teamId, keyPem, bundleId };
}
