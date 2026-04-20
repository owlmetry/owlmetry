export const BILLING_TIERS = ["paid", "trial", "free"] as const;
export type BillingTier = (typeof BILLING_TIERS)[number];

const VALID_TIER_SET: ReadonlySet<string> = new Set(BILLING_TIERS);

/** Parse a comma-separated `billing_status` value into a tier set. Unknown values are ignored. */
export function parseBillingTiers(value: string | undefined | null): Set<BillingTier> {
  const set = new Set<BillingTier>();
  if (!value) return set;
  for (const raw of value.split(",")) {
    const v = raw.trim().toLowerCase();
    if (VALID_TIER_SET.has(v)) set.add(v as BillingTier);
  }
  return set;
}

/** True when the parsed tier set should narrow results — false for empty or all-three (no-op). */
export function isBillingFilterActive(tiers: Set<BillingTier>): boolean {
  return tiers.size > 0 && tiers.size < BILLING_TIERS.length;
}

/** Serialize a tier set back to the canonical comma-separated wire format (stable order). */
export function serializeBillingTiers(tiers: Iterable<BillingTier>): string {
  const set = new Set(tiers);
  return BILLING_TIERS.filter((t) => set.has(t)).join(",");
}
