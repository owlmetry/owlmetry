import {
  ASA_PROPERTY_PREFIX,
  ATTRIBUTION_SOURCE_PROPERTY,
  ATTRIBUTION_SOURCE_VALUES,
  LIKELY_APP_REVIEWER_PROPERTY,
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
 * Detect Apple's App Store review sandbox attribution fixture. Observed in
 * production on 2026-04-22 across three apps submitted for review on the same
 * day — installs from reviewer devices resolved with `campaignId == adGroupId
 * == adId` (all three equal to 1234567890), `keywordId = 12323222`, and
 * `claimType = "Click"` (Apple's real responses use lowercase `"click"`).
 * Three distinct Apple entities can't share an ID in production data, so the
 * equality check is a safe tell even if Apple changes the exact numbers.
 */
export function isLikelyAppReviewerFixture(
  response: AppleAdsAttributionResponse,
): boolean {
  if (!response.attribution) return false;
  const { campaignId, adGroupId, adId } = response;
  if (
    typeof campaignId === "number" &&
    typeof adGroupId === "number" &&
    typeof adId === "number" &&
    campaignId > 0 &&
    campaignId === adGroupId &&
    campaignId === adId
  ) {
    return true;
  }
  return false;
}

/**
 * Map an Apple attribution response into the flat string-keyed properties we
 * store on `app_users`. Always sets `attribution_source`. Only writes `asa_*`
 * fields when Apple actually attributed the install (attribution === true).
 */
export function mapAppleAttributionToProperties(
  response: AppleAdsAttributionResponse,
): Record<string, string> {
  const props: Record<string, string> = {};

  if (!response.attribution) {
    props[ATTRIBUTION_SOURCE_PROPERTY] = ATTRIBUTION_SOURCE_VALUES.none;
    return props;
  }

  props[ATTRIBUTION_SOURCE_PROPERTY] = ATTRIBUTION_SOURCE_VALUES.appleSearchAds;

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

  if (isLikelyAppReviewerFixture(response)) {
    props[LIKELY_APP_REVIEWER_PROPERTY] = "true";
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
    return {
      status: "resolved",
      attributed: false,
      properties: mapAppleAttributionToProperties({ attribution: false }),
    };
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
  return {
    status: "resolved",
    attributed: true,
    properties: mapAppleAttributionToProperties(mockResponse),
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

  if (response.status === 400) {
    const body = await response.text().catch(() => "");
    return { status: "invalid", reason: body || "bad request" };
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

  return {
    status: "resolved",
    attributed: data.attribution === true,
    properties: mapAppleAttributionToProperties(data),
  };
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
