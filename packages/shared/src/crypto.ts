import { createHash, randomBytes } from "node:crypto";
import { API_KEY_PREFIX } from "./constants.js";
import type { ApiKeyType } from "./auth.js";

export const KEY_PREFIX_LENGTH = 16;

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(keyType: ApiKeyType): { fullKey: string; keyHash: string; keyPrefix: string } {
  const fullKey = `${API_KEY_PREFIX[keyType]}${randomBytes(24).toString("hex")}`;
  return {
    fullKey,
    keyHash: hashApiKey(fullKey),
    keyPrefix: fullKey.slice(0, KEY_PREFIX_LENGTH),
  };
}

export function generateVerificationCode(): { code: string; codeHash: string } {
  const code = String(randomBytes(3).readUIntBE(0, 3) % 900000 + 100000);
  return { code, codeHash: hashVerificationCode(code) };
}

export function hashVerificationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
