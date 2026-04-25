import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import type { ApnsConfig } from "./config.js";

/**
 * Sign an APNs auth JWT (ES256, .p8 PEM, raw r||s signature).
 *
 * Apple accepts the same JWT for up to 60 minutes; we cache for ~50 to leave
 * headroom. Required claims per
 * https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
 */
export function signApnsJwt(
  config: Pick<ApnsConfig, "keyId" | "teamId" | "keyPem">,
  iat: number = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const payload = { iss: config.teamId, iat };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;

  const key = createPrivateKey({ key: config.keyPem, format: "pem" });
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });

  return `${signingInput}.${signature.toString("base64url")}`;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** In-process token cache: re-sign every 50 min (Apple's hard cap is 60). */
const TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

export function getCachedApnsJwt(config: Pick<ApnsConfig, "keyId" | "teamId" | "keyPem">): string {
  const cached = cache.get(config.keyId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.token;
  const token = signApnsJwt(config);
  cache.set(config.keyId, { token, expiresAt: now + TOKEN_CACHE_TTL_MS });
  return token;
}
