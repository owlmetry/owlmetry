import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@owlmetry/shared";

export function normalizeLimit(rawLimit: unknown): number {
  return Math.min(
    Math.max(Number(rawLimit) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );
}
