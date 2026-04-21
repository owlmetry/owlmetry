import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@owlmetry/shared";

export function normalizeLimit(rawLimit: unknown): number {
  return Math.min(
    Math.max(Number(rawLimit) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );
}

/**
 * Encode a keyset-pagination cursor from a `(timestamp, id)` pair.
 * The timestamp is the primary sort key; id is a tie-breaker for equal timestamps.
 */
export function encodeKeysetCursor(timestamp: Date, id: string): string {
  return Buffer.from(JSON.stringify([timestamp.toISOString(), id])).toString("base64url");
}

/**
 * Decode a keyset cursor back to `{ timestamp, id }`.
 * Returns null when the cursor is malformed (e.g. legacy plain-UUID cursors) so
 * callers can choose a fallback rather than throwing.
 */
export function decodeKeysetCursor(cursor: string): { timestamp: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (Array.isArray(parsed) && parsed.length === 2) {
      return { timestamp: parsed[0], id: parsed[1] };
    }
    return null;
  } catch {
    return null;
  }
}
