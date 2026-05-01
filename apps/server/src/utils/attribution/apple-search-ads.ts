import {
  ASA_PROPERTY_PREFIX,
  ATTRIBUTION_SOURCE_PROPERTY,
  ATTRIBUTION_SOURCE_VALUES,
  type AttributionDevMock,
} from "@owlmetry/shared";
import type { AttributionResolveOutcome, AttributionResolver } from "./types.js";

const APPLE_ADS_ATTRIBUTION_ENDPOINT = "https://api-adservices.apple.com/api/v1/";
const PENDING_RETRY_SECONDS = 60;

/**
 * Shape of a successful Apple AdServices Attribution response.
 * Apple uses `0` to indicate "not present" for id fields (so we normalize
 * those away). See https://developer.apple.com/documentation/ad_services
 */
interface AppleAdsAttributionResponse {
  attribution: boolean;
  orgId?: number;
  campaignId?: number;
  adGroupId?: number;
  keywordId?: number;
  creativeSetId?: number;
  adId?: number;
  conversionType?: string;
  claimType?: string;
  countryOrRegion?: string;
  clickDate?: string | null;
}

/**
 * Detect Apple's deliberate non-production attribution fixture. Apple's
 * AdServices API returns a fixed dummy payload — same numeric ID across
 * campaign/ad_group/ad (`1234567890`), `keywordId = 12323222`,
 * `claimType = "Click"` (real Apple responses use lowercase `"click"`) — for
 * **TestFlight builds, Xcode-deployed dev builds on real devices, and the
 * iOS simulator**. The fixture exists so SDK developers can verify their
 * attribution plumbing without running real ads.
 *
 * Sources: https://developer.apple.com/forums/thread/66161 ("sample dummy
 * data when you make the call to Apples Servers from an iOS Simulator
 * (maybe also from an actual test device in debug mode)") and third-party
 * SDK docs ("debugging or testing your app using TestFlight or a developer
 * app, Apple Ads returns dummy values of test campaign data with Campaign
 * ID as 1234567890. This dummy data should be filtered out").
 *
 * We match on the three-way ID equality because it's the structural tell
 * real Apple data can never produce — campaign, ad group, and ad are
 * distinct entities. The check survives Apple rotating the specific numeric
 * fixture value or re-casing `claimType`.
 */
export function isLikelyAppleTestInstall(
  response: AppleAdsAttributionResponse,
): boolean {
  if (!response.attribution) return false;
  const { campaignId, adGroupId, adId } = response;
  return (
    typeof campaignId === "number" &&
    typeof adGroupId === "number" &&
    typeof adId === "number" &&
    campaignId > 0 &&
    campaignId === adGroupId &&
    campaignId === adId
  );
}

/**
 * Map an Apple attribution response into the flat string-keyed properties we
 * store on `app_users`. Always sets `attribution_source`.
 *
 * Three branches:
 *   1. `attribution: false` → `{ attribution_source: "none" }` (organic).
 *   2. Fixture pattern (see `isLikelyAppleTestInstall`) → short-circuit to
 *      `{ attribution_source: "apple_test_install" }`. No `asa_*` fields:
 *      the IDs Apple returned are placeholders, so storing them just
 *      pollutes dashboards and burns an Apple Ads enrichment call.
 *   3. Real attribution → set `attribution_source = "apple_search_ads"`
 *      plus the populated `asa_*` IDs.
 */
export function mapAppleAttributionToProperties(
  response: AppleAdsAttributionResponse,
): Record<string, string> {
  if (!response.attribution) {
    return { [ATTRIBUTION_SOURCE_PROPERTY]: ATTRIBUTION_SOURCE_VALUES.none };
  }

  if (isLikelyAppleTestInstall(response)) {
    return { [ATTRIBUTION_SOURCE_PROPERTY]: ATTRIBUTION_SOURCE_VALUES.appleTestInstall };
  }

  const props: Record<string, string> = {
    [ATTRIBUTION_SOURCE_PROPERTY]: ATTRIBUTION_SOURCE_VALUES.appleSearchAds,
  };

  // Apple returns 0 for "not present" — treat those as absent.
  const idFields: Array<[keyof AppleAdsAttributionResponse, string]> = [
    ["campaignId", `${ASA_PROPERTY_PREFIX}campaign_id`],
    ["adGroupId", `${ASA_PROPERTY_PREFIX}ad_group_id`],
    ["keywordId", `${ASA_PROPERTY_PREFIX}keyword_id`],
    ["adId", `${ASA_PROPERTY_PREFIX}ad_id`],
    ["creativeSetId", `${ASA_PROPERTY_PREFIX}creative_set_id`],
  ];
  for (const [sourceField, destKey] of idFields) {
    const value = response[sourceField];
    if (typeof value === "number" && value > 0) {
      props[destKey] = String(value);
    }
  }

  if (response.claimType && response.claimType.length > 0) {
    props[`${ASA_PROPERTY_PREFIX}claim_type`] = response.claimType;
  }

  return props;
}

function buildMockOutcome(
  devMock: AttributionDevMock,
): AttributionResolveOutcome {
  if (devMock === "pending") {
    return { status: "pending", retryAfterSeconds: PENDING_RETRY_SECONDS };
  }
  if (devMock === "unattributed") {
    return resolveAppleResponse({ attribution: false });
  }
  // "attributed" — canned payload with plausible numeric ids.
  const mockResponse: AppleAdsAttributionResponse = {
    attribution: true,
    orgId: 40669820,
    campaignId: 542370539,
    adGroupId: 542317095,
    keywordId: 87675432,
    creativeSetId: 542317096,
    adId: 542317097,
    conversionType: "Download",
    claimType: "click",
    countryOrRegion: "US",
    clickDate: "2026-01-01T00:00:00Z",
  };
  return resolveAppleResponse(mockResponse);
}

/** Fold an Apple AdServices response into the resolver outcome shape. Fixture
 *  installs report `attributed: false` so the route doesn't schedule an
 *  Apple Ads enrichment call for the placeholder IDs. */
function resolveAppleResponse(
  data: AppleAdsAttributionResponse,
): AttributionResolveOutcome {
  const properties = mapAppleAttributionToProperties(data);
  const isRealAttribution =
    properties[ATTRIBUTION_SOURCE_PROPERTY] === ATTRIBUTION_SOURCE_VALUES.appleSearchAds;
  return {
    status: "resolved",
    attributed: isRealAttribution,
    properties,
  };
}

/** Called by the route for real (non-mocked) traffic. */
async function resolveFromApple(token: string): Promise<AttributionResolveOutcome> {
  let response: Response;
  try {
    response = await fetch(APPLE_ADS_ATTRIBUTION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: token,
    });
  } catch (err) {
    return {
      status: "upstream_error",
      upstreamStatus: 0,
      message: err instanceof Error ? err.message : "network error calling Apple attribution API",
    };
  }

  // Apple's 404 means "attribution record not ready yet" — canonical retry path.
  if (response.status === 404) {
    return { status: "pending", retryAfterSeconds: PENDING_RETRY_SECONDS };
  }

  // Apple returns 400 for apps that aren't registered with any Apple Search
  // Ads campaigns. For our analytics purposes that's indistinguishable from
  // "organic install" — same bucket as a 200-OK `attribution: false`. Warn-log
  // the upstream body so a sustained pattern (bundle-ID mismatch, real
  // malformation) is still spottable in server logs.
  if (response.status === 400) {
    const body = await response.text().catch(() => "");
    console.warn(`[attribution/apple-search-ads] Apple /v1/ returned 400, treating as organic install. Body: ${body || "(empty)"}`);
    return resolveAppleResponse({ attribution: false });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      status: "upstream_error",
      upstreamStatus: response.status,
      message: body || `upstream ${response.status}`,
    };
  }

  let data: AppleAdsAttributionResponse;
  try {
    data = (await response.json()) as AppleAdsAttributionResponse;
  } catch (err) {
    return {
      status: "upstream_error",
      upstreamStatus: response.status,
      message: err instanceof Error ? err.message : "failed to decode Apple response",
    };
  }

  return resolveAppleResponse(data);
}

export const appleSearchAdsResolver: AttributionResolver<string> = {
  name: "apple-search-ads",
  propertyPrefix: ASA_PROPERTY_PREFIX,
  async resolve(token, opts) {
    const devMockAllowed = process.env.NODE_ENV !== "production";
    if (devMockAllowed && opts.devMock) {
      return buildMockOutcome(opts.devMock);
    }
    if (!token || typeof token !== "string" || token.length === 0) {
      return { status: "invalid", reason: "empty token" };
    }
    return resolveFromApple(token);
  },
};
