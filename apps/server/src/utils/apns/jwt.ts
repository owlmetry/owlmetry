import { signEs256Jwt } from "../apple-jwt.js";
import type { ApnsConfig } from "./config.js";

/**
 * Sign an APNs auth JWT (ES256, .p8 PEM). Apple accepts the same JWT for up
 * to 60 minutes; we cache for 50 to leave headroom. Spec:
 * https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
 */
export function signApnsJwt(
  config: Pick<ApnsConfig, "keyId" | "teamId" | "keyPem">,
  iat: number = Math.floor(Date.now() / 1000),
): string {
  return signEs256Jwt({
    header: { alg: "ES256", kid: config.keyId, typ: "JWT" },
    payload: { iss: config.teamId, iat },
    keyPem: config.keyPem,
  });
}

const TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;

const cache = new Map<string, { token: string; expiresAt: number }>();

export function getCachedApnsJwt(config: Pick<ApnsConfig, "keyId" | "teamId" | "keyPem">): string {
  const cached = cache.get(config.keyId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.token;
  const token = signApnsJwt(config);
  cache.set(config.keyId, { token, expiresAt: now + TOKEN_CACHE_TTL_MS });
  return token;
}
