import type { AttributionNetwork } from "@owlmetry/shared";
import type { AttributionResolver } from "./types.js";
import { appleSearchAdsResolver } from "./apple-search-ads.js";

/**
 * Resolver registry. Adding a new network = add a file in this directory,
 * export its resolver, and add it to the map. The route dispatches via
 * `ATTRIBUTION_RESOLVERS[:source]`.
 */
export const ATTRIBUTION_RESOLVERS: Record<AttributionNetwork, AttributionResolver<string>> = {
  "apple-search-ads": appleSearchAdsResolver,
};

export { mapAppleAttributionToProperties, appleSearchAdsResolver } from "./apple-search-ads.js";
export {
  mapRevenueCatAttributesToAttributionProperties,
  normalizeWebhookSubscriberAttributes,
} from "./revenuecat.js";
export type { AttributionResolveOutcome, AttributionResolver } from "./types.js";
