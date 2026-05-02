/**
 * Attribution types shared across networks.
 *
 * Current network: Apple Search Ads (via AdServices framework tokens).
 * Future networks (Meta, Google Ads, TikTok) slot in here by adding to
 * `ATTRIBUTION_NETWORKS` and contributing their own property prefix.
 *
 * Property model:
 *   - `attribution_source` is a single cross-network property whose value
 *     identifies the winning network (e.g. "apple_search_ads", "meta"),
 *     "none" when capture happened but the network didn't attribute, or
 *     "apple_test_install" for Apple's deliberate non-production fixture
 *     (TestFlight / Xcode dev build / simulator) — see `appleTestInstall`
 *     below.
 *   - Network-specific fields are namespaced by prefix (`asa_*`, `meta_*`, …).
 */

export const ATTRIBUTION_NETWORKS = ["apple-search-ads"] as const;
export type AttributionNetwork = (typeof ATTRIBUTION_NETWORKS)[number];

export const ATTRIBUTION_SOURCE_PROPERTY = "attribution_source";

export const ATTRIBUTION_SOURCE_VALUES = {
  appleSearchAds: "apple_search_ads",
  none: "none",
  // Apple's AdServices API deliberately returns a fixed dummy payload (same
  // numeric ID across campaign/ad_group/ad, keyword_id "12323222",
  // claim_type "Click") for non-production installs — TestFlight builds,
  // Xcode-deployed dev builds on real devices, and the simulator. The server
  // detects this pattern and short-circuits to this value with no `asa_*`
  // fields, so dashboards can filter test installs out of acquisition
  // reporting without false-positives on real ASA data.
  appleTestInstall: "apple_test_install",
} as const;
export type AttributionSourceValue =
  (typeof ATTRIBUTION_SOURCE_VALUES)[keyof typeof ATTRIBUTION_SOURCE_VALUES];

// Apple Search Ads property keys (namespace: `asa_`).
// ID fields come from Apple's AdServices API (first-party, live flow). Name
// fields and the raw search term come from two complementary sources, both
// covering every attributed user (subscriber or free):
//   1. The Apple Ads Campaign Management API (per-project OAuth integration) —
//      Owlmetry resolves IDs → names directly. Self-contained, no RC needed.
//   2. RevenueCat's stored subscriber attributes — RC does the same ID → name
//      resolution server-side on AdServices token receipt (not gated on a
//      subscription event; verified empirically for a non-subscribing user),
//      and we pull the resolved names via V2 customer attributes during sync
//      and off incoming webhooks. Webhook *delivery* is subscription-gated by
//      RC, so free users only receive enrichment via bulk sync.
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

/**
 * Per-network mapping from logical hierarchy levels (campaign, ad group,
 * keyword, ad) to the property keys stored on `app_users.properties`. Used
 * by the advertising-insights routes/SQL aggregator so the same code path
 * works across networks — adding Meta/Google/TikTok later is one map entry.
 *
 * `attribution_source` values used as keys here match
 * `ATTRIBUTION_SOURCE_VALUES` (e.g. `"apple_search_ads"`).
 */
export interface AttributionNetworkDimensions {
  campaignIdKey: string;
  campaignNameKey: string;
  adGroupIdKey: string;
  adGroupNameKey: string;
  keywordIdKey: string;
  keywordNameKey: string;
  adIdKey: string;
  adNameKey: string;
}

export const ATTRIBUTION_NETWORK_DIMENSIONS: Record<string, AttributionNetworkDimensions> = {
  apple_search_ads: {
    campaignIdKey: "asa_campaign_id",
    campaignNameKey: "asa_campaign_name",
    adGroupIdKey: "asa_ad_group_id",
    adGroupNameKey: "asa_ad_group_name",
    keywordIdKey: "asa_keyword_id",
    keywordNameKey: "asa_keyword",
    adIdKey: "asa_ad_id",
    adNameKey: "asa_ad_name",
  },
};

export type AdsAttributionSource = keyof typeof ATTRIBUTION_NETWORK_DIMENSIONS;

export const ADS_ATTRIBUTION_SOURCES = Object.keys(
  ATTRIBUTION_NETWORK_DIMENSIONS,
) as AdsAttributionSource[];

// All property keys the attribution subsystem may write for a user. Useful
// for UI filters that need to distinguish attribution props from custom ones.
export const ATTRIBUTION_RESERVED_KEYS: readonly string[] = [
  ATTRIBUTION_SOURCE_PROPERTY,
  ...ASA_PROPERTY_KEYS,
];

/**
 * Property keys surfaceable as dashboard columns on the Users page.
 *
 * Keep this list short and focused on human-readable values (names, not
 * numeric IDs) — the goal is to let a team see their acquisition mix in the
 * users table without opening every user sheet.
 *
 * Adding a new ad network: append rows with a new `source` label. The
 * column registry in `apps/web/src/lib/user-columns.tsx` picks them up
 * automatically and the picker groups them under the `source` heading.
 */
export interface AttributionColumnKey {
  /** Key in `app_users.properties`. */
  propertyKey: string;
  /** Header label + picker label. */
  label: string;
  /** Group shown in the picker (e.g. "Apple Search Ads"). */
  source: string;
}

export const ATTRIBUTION_COLUMN_KEYS: AttributionColumnKey[] = [
  { propertyKey: ATTRIBUTION_SOURCE_PROPERTY, label: "Attribution Source", source: "Attribution" },
  { propertyKey: "asa_campaign_name", label: "Campaign", source: "Apple Search Ads" },
  { propertyKey: "asa_ad_group_name", label: "Ad Group", source: "Apple Search Ads" },
  { propertyKey: "asa_keyword", label: "Keyword", source: "Apple Search Ads" },
  { propertyKey: "asa_ad_name", label: "Ad", source: "Apple Search Ads" },
];

// Maximum number of "pending" responses the SDK will follow before giving up
// and writing `attribution_source="none"`. Apple's attribution record can
// take up to ~24h to populate, so 5 launches covers ~1–2 days of normal use.
export const ASA_MAX_PENDING_ATTEMPTS = 5;

// --- Advertising insights types ---
//
// Shared between the dashboard, CLI, and MCP. The hierarchy `campaign →
// ad_group → keyword|ad` is generic over `attribution_source` — see
// `ATTRIBUTION_NETWORK_DIMENSIONS`.

export type AdsLeafType = "keyword" | "ad";

export interface AdsRow {
  /** Network-specific ID (e.g. ASA campaign ID). */
  id: string;
  /** Resolved name; null pre-enrichment (ID known, name not yet). */
  name: string | null;
  user_count: number;
  paying_user_count: number;
  total_revenue_usd: number;
  arpu: number;
  /**
   * Lifetime spend in USD. Null when (a) no ad-network integration is
   * connected, (b) no row in `ad_*_lifetime` matches yet, or (c) the
   * advertising org's reporting currency isn't USD (we don't fake-convert).
   */
  total_spend_usd: number | null;
  /** `total_revenue_usd / total_spend_usd`. Null when spend is null or 0. */
  roas: number | null;
  /** ISO date `YYYY-MM-DD` of the campaign / ad-group's start, when known. */
  start_date: string | null;
  /** Network-side status snapshot — e.g. "ENABLED" / "PAUSED" / "DELETED". */
  status: string | null;
}

export interface AdsCampaignsResponse {
  attribution_source: string;
  campaigns: AdsRow[];
  total_user_count: number;
  total_paying_user_count: number;
  total_revenue_usd: number;
  /** SUM of visible rows' `total_spend_usd`; null when no row reported spend. */
  total_spend_usd: number | null;
  /** Most recent `revenue_synced_at` across the project's RC-synced users; null when never synced. */
  revenue_synced_at: string | null;
  /** Most recent `last_synced_at` across the project's `ad_*_lifetime` rows; null when never synced. */
  ad_metrics_synced_at: string | null;
  /**
   * Non-null when at least one `ad_*_lifetime` row's currency isn't USD;
   * carries the offending currency code (e.g. `"EUR"`) so the UI can render
   * a "spend in <currency>; ROAS unavailable until USD is supported" banner.
   */
  currency_warning: string | null;
}

/** Campaign row from the team-scoped endpoint — same fields as `AdsRow` plus the owning project. */
export interface TeamAdsRow extends AdsRow {
  project_id: string;
}

export interface TeamAdsCampaignsResponse {
  attribution_source: string;
  campaigns: TeamAdsRow[];
  total_user_count: number;
  total_paying_user_count: number;
  total_revenue_usd: number;
  total_spend_usd: number | null;
  /** Most recent `revenue_synced_at` across every accessible project's RC-synced users; null when never synced. */
  revenue_synced_at: string | null;
  ad_metrics_synced_at: string | null;
  currency_warning: string | null;
}

export interface AdsAdGroupsResponse {
  attribution_source: string;
  campaign_id: string;
  campaign_name: string | null;
  ad_groups: AdsRow[];
  total_spend_usd: number | null;
  ad_metrics_synced_at: string | null;
  currency_warning: string | null;
}

export interface AdsLeavesResponse {
  attribution_source: string;
  campaign_id: string;
  campaign_name: string | null;
  ad_group_id: string;
  ad_group_name: string | null;
  keywords: AdsRow[];
  ads: AdsRow[];
}

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
