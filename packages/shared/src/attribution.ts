/**
 * Attribution types shared across networks.
 *
 * Current network: Apple Search Ads (via AdServices framework tokens).
 * Future networks (Meta, Google Ads, TikTok) slot in here by adding to
 * `ATTRIBUTION_NETWORKS` and contributing their own property prefix.
 *
 * Property model:
 *   - `attribution_source` is a single cross-network property whose value
 *     identifies the winning network (e.g. "apple_search_ads", "meta", or
 *     "none" when capture happened but Apple/etc. didn't attribute).
 *   - Network-specific fields are namespaced by prefix (`asa_*`, `meta_*`, …).
 */

export const ATTRIBUTION_NETWORKS = ["apple-search-ads"] as const;
export type AttributionNetwork = (typeof ATTRIBUTION_NETWORKS)[number];

export const ATTRIBUTION_SOURCE_PROPERTY = "attribution_source";

export const ATTRIBUTION_SOURCE_VALUES = {
  appleSearchAds: "apple_search_ads",
  none: "none",
} as const;
export type AttributionSourceValue =
  (typeof ATTRIBUTION_SOURCE_VALUES)[keyof typeof ATTRIBUTION_SOURCE_VALUES];

// Apple Search Ads property keys (namespace: `asa_`).
// ID fields come from Apple's AdServices API (first-party, live flow). Name
// fields and the raw search term come from two complementary sources:
//   1. The Apple Ads Campaign Management API (per-project OAuth integration) —
//      resolves IDs → names directly for any attributed user, subscriber or not.
//   2. RevenueCat's stored subscriber attributes — fills names as a side-effect
//      of a subscription event, only for paying users.
// Apple's AdServices API intentionally returns only numeric IDs; both sources
// above are additive on top of that. A user caught by both ends up with every
// slot populated.
export const ASA_PROPERTY_PREFIX = "asa_";
export const ASA_PROPERTY_KEYS = [
  "asa_campaign_id",
  "asa_ad_group_id",
  "asa_keyword_id",
  "asa_claim_type",
  "asa_ad_id",
  "asa_creative_set_id",
  "asa_campaign_name",
  "asa_ad_group_name",
  "asa_keyword",
  "asa_ad_name",
] as const;
export type AsaPropertyKey = (typeof ASA_PROPERTY_KEYS)[number];

// Pairs `asa_*_id` (set by the Swift SDK at install time) with the
// corresponding `asa_*_name` key filled by the Campaign Management API
// integration. Single source of truth shared by the enrichment resolver and
// the sync job — adding a new ID type means adding one row here and nothing
// else.
export const ASA_ID_NAME_PAIRS = [
  { idKey: "asa_campaign_id", nameKey: "asa_campaign_name" },
  { idKey: "asa_ad_group_id", nameKey: "asa_ad_group_name" },
  { idKey: "asa_keyword_id", nameKey: "asa_keyword" },
  { idKey: "asa_ad_id", nameKey: "asa_ad_name" },
] as const;

// All property keys the attribution subsystem may write for a user. Useful
// for UI filters that need to distinguish attribution props from custom ones.
export const ATTRIBUTION_RESERVED_KEYS: readonly string[] = [
  ATTRIBUTION_SOURCE_PROPERTY,
  ...ASA_PROPERTY_KEYS,
];

// Maximum number of "pending" responses the SDK will follow before giving up
// and writing `attribution_source="none"`. Apple's attribution record can
// take up to ~24h to populate, so 5 launches covers ~1–2 days of normal use.
export const ASA_MAX_PENDING_ATTEMPTS = 5;

// Dev-mock values accepted by the attribution route when NODE_ENV !== "production".
// Lets local/integration tests exercise every branch without hitting Apple.
export const ATTRIBUTION_DEV_MOCKS = ["attributed", "unattributed", "pending"] as const;
export type AttributionDevMock = (typeof ATTRIBUTION_DEV_MOCKS)[number];

// --- API types ---

export interface SubmitAppleSearchAdsAttributionRequest {
  user_id: string;
  attribution_token: string;
  /** Development helper — ignored in production. */
  dev_mock?: AttributionDevMock;
}

export interface SubmitAppleSearchAdsAttributionResponse {
  /**
   * `true` — Apple attributed the install (properties populated).
   * `false` — Apple responded but said not attributed (`attribution_source=none`).
   * `null` — pending (Apple hasn't built the record yet, SDK should retry later).
   */
  attributed: boolean | null;
  pending: boolean;
  retry_after_seconds?: number;
  properties: Record<string, string>;
}
