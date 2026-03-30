import { createHash, randomBytes } from "node:crypto";
import { API_KEY_PREFIX } from "./constants.js";
import type { ApiKeyType } from "./auth.js";

export function generateApiKeySecret(keyType: ApiKeyType): string {
  return `${API_KEY_PREFIX[keyType]}${randomBytes(24).toString("hex")}`;
}

export function generateVerificationCode(): { code: string; codeHash: string } {
  const code = String(randomBytes(3).readUIntBE(0, 3) % 900000 + 100000);
  return { code, codeHash: hashVerificationCode(code) };
}

export function hashVerificationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}
