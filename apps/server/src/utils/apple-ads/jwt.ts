import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import type { AppleAdsConfig } from "./config.js";

/**
 * Sign a client_assertion JWT for the Apple Ads OAuth token exchange.
 * See https://developer.apple.com/documentation/apple_ads/implementing-oauth-for-the-apple-search-ads-api.
 *
 * Algorithm is ES256 (ECDSA on P-256 with SHA-256). Apple requires the raw
 * (r || s) signature encoding, not DER — Node's `dsaEncoding: "ieee-p1363"`
 * gives that directly.
 *
 * `exp` defaults to 5 minutes from `iat`. Apple accepts up to 180 days, but a
 * short TTL is the safer default — we re-sign on every mint (which happens
 * hourly per project).
 */
export function signAppleAdsClientAssertion(
  config: Pick<AppleAdsConfig, "client_id" | "team_id" | "key_id" | "private_key_pem">,
  opts: { iat?: number; exp?: number } = {},
): string {
  const iat = opts.iat ?? Math.floor(Date.now() / 1000);
  const exp = opts.exp ?? iat + 300;

  const header = { alg: "ES256", kid: config.key_id, typ: "JWT" };
  const payload = {
    iss: config.team_id,
    sub: config.client_id,
    aud: "https://appleid.apple.com",
    iat,
    exp,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;

  const key = createPrivateKey({ key: config.private_key_pem, format: "pem" });
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });

  return `${signingInput}.${base64UrlFromBuffer(signature)}`;
}

function base64UrlEncode(value: string): string {
  return base64UrlFromBuffer(Buffer.from(value, "utf8"));
}

function base64UrlFromBuffer(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
