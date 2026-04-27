import { signEs256Jwt } from "../apple-jwt.js";
import type { AppStoreConnectConfig } from "./config.js";

/**
 * Sign an App Store Connect API bearer JWT.
 * See https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
 *
 * Apple caps `exp` at iat + 1200 (20 minutes). We use 19 minutes by default to
 * leave a 60-second clock-skew safety margin — same rationale as the ASA
 * client_assertion default.
 */
export function signAppStoreConnectJwt(
  config: Pick<AppStoreConnectConfig, "issuer_id" | "key_id" | "private_key_p8">,
  opts: { iat?: number; exp?: number } = {},
): string {
  const iat = opts.iat ?? Math.floor(Date.now() / 1000);
  const exp = opts.exp ?? iat + 1140;
  return signEs256Jwt({
    header: { alg: "ES256", kid: config.key_id, typ: "JWT" },
    payload: {
      iss: config.issuer_id,
      iat,
      exp,
      aud: "appstoreconnect-v1",
    },
    keyPem: config.private_key_p8,
  });
}
