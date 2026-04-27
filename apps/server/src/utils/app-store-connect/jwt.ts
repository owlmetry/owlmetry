import { createPrivateKey } from "node:crypto";
import { signEs256Jwt } from "../apple-jwt.js";
import type { AppStoreConnectConfig } from "./config.js";

/**
 * Sanity-check that a pasted .p8 string parses as a valid EC private key
 * (PKCS#8 or SEC1 PEM). Returns null when valid, an error message otherwise.
 * Called from the create/update routes so we fail fast with a clear message
 * instead of letting an invalid PEM surface as a generic auth_error during
 * the next sync.
 */
export function validateAppStoreConnectPem(pem: string): string | null {
  try {
    createPrivateKey({ key: pem, format: "pem" });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return `private_key_p8 is not a valid PEM (${message}). Paste the full .p8 contents including the BEGIN/END lines.`;
  }
}

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
