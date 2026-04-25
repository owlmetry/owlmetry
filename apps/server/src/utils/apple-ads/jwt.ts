import { signEs256Jwt } from "../apple-jwt.js";
import type { AppleAdsConfig } from "./config.js";

/**
 * Sign a client_assertion JWT for the Apple Ads OAuth token exchange.
 * See https://developer.apple.com/documentation/apple_ads/implementing-oauth-for-the-apple-search-ads-api.
 *
 * `exp` defaults to 5 minutes from `iat`. Apple accepts up to 180 days, but a
 * short TTL is the safer default — we re-sign on every mint (hourly per project).
 */
export function signAppleAdsClientAssertion(
  config: Pick<AppleAdsConfig, "client_id" | "team_id" | "key_id" | "private_key_pem">,
  opts: { iat?: number; exp?: number } = {},
): string {
  const iat = opts.iat ?? Math.floor(Date.now() / 1000);
  const exp = opts.exp ?? iat + 300;
  return signEs256Jwt({
    header: { alg: "ES256", kid: config.key_id, typ: "JWT" },
    payload: {
      iss: config.team_id,
      sub: config.client_id,
      aud: "https://appleid.apple.com",
      iat,
      exp,
    },
    keyPem: config.private_key_pem,
  });
}
