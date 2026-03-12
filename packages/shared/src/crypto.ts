import { createHash } from "node:crypto";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
