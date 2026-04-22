import type { AppleAdsConfig } from "./config.js";
import {
  getAppleAdsCampaign,
  getAppleAdsAdGroup,
  getAppleAdsTargetingKeyword,
  getAppleAdsAd,
  type AppleAdsResult,
} from "./client.js";

/**
 * Given a user's existing stored properties, look up the human-readable
 * Apple Search Ads names/text for whichever IDs are present. Returns a flat
 * `Record<string, string>` suitable for merging via `selectUnsetProps` /
 * `mergeUserProperties`. Never returns `attribution_source` — that's the live
 * resolver's job — and never overwrites existing keys (caller uses
 * `selectUnsetProps`).
 *
 * Partial success is the norm: if the ad group has been deleted but the
 * campaign still exists, we return `asa_campaign_name` and skip ad group.
 * Auth errors propagate so the caller can surface them in the UI.
 */
export interface EnrichmentOutcome {
  props: Record<string, string>;
  /** First auth/config error encountered, if any — aborts the rest of the call. */
  authError?: string;
  /** Non-fatal per-field errors (5xx, network), for telemetry. */
  fieldErrors: Array<{ field: "campaign" | "ad_group" | "keyword" | "ad"; statusCode: number; message: string }>;
}

export async function enrichAppleAdsNames(
  config: AppleAdsConfig,
  existingProps: Record<string, unknown>,
): Promise<EnrichmentOutcome> {
  const props: Record<string, string> = {};
  const fieldErrors: EnrichmentOutcome["fieldErrors"] = [];

  const campaignId = pickIdString(existingProps, "asa_campaign_id");
  const adGroupId = pickIdString(existingProps, "asa_ad_group_id");
  const keywordId = pickIdString(existingProps, "asa_keyword_id");
  const adId = pickIdString(existingProps, "asa_ad_id");

  if (!campaignId) {
    return { props, fieldErrors };
  }

  const campaignRes = await getAppleAdsCampaign(config, campaignId);
  const authError = firstAuthError(campaignRes);
  if (authError) return { props, authError, fieldErrors };
  captureName(props, "asa_campaign_name", campaignRes, (d) => d.name);
  captureFieldError(fieldErrors, "campaign", campaignRes);

  // Ad group, keyword, and ad all require campaign scoping — they're all
  // nested under `/campaigns/{cid}/...`. If campaign was deleted we skip them
  // (Apple will return 404 anyway, so this is just an optimization).
  if (adGroupId) {
    const agRes = await getAppleAdsAdGroup(config, campaignId, adGroupId);
    const agAuthError = firstAuthError(agRes);
    if (agAuthError) return { props, authError: agAuthError, fieldErrors };
    captureName(props, "asa_ad_group_name", agRes, (d) => d.name);
    captureFieldError(fieldErrors, "ad_group", agRes);
  }

  if (adGroupId && keywordId) {
    const kwRes = await getAppleAdsTargetingKeyword(config, campaignId, adGroupId, keywordId);
    const kwAuthError = firstAuthError(kwRes);
    if (kwAuthError) return { props, authError: kwAuthError, fieldErrors };
    captureName(props, "asa_keyword", kwRes, (d) => d.text);
    captureFieldError(fieldErrors, "keyword", kwRes);
  }

  if (adGroupId && adId) {
    const adRes = await getAppleAdsAd(config, campaignId, adGroupId, adId);
    const adAuthError = firstAuthError(adRes);
    if (adAuthError) return { props, authError: adAuthError, fieldErrors };
    captureName(props, "asa_ad_name", adRes, (d) => d.name);
    captureFieldError(fieldErrors, "ad", adRes);
  }

  return { props, fieldErrors };
}

function pickIdString(props: Record<string, unknown>, key: string): string | null {
  const raw = props[key];
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number" && raw > 0) return String(raw);
  return null;
}

function captureName<T>(
  props: Record<string, string>,
  key: string,
  result: AppleAdsResult<T>,
  extract: (data: T) => string | undefined,
): void {
  if (result.status !== "found") return;
  const value = extract(result.data);
  if (typeof value === "string" && value.length > 0) {
    props[key] = value;
  }
}

function captureFieldError<T>(
  errors: EnrichmentOutcome["fieldErrors"],
  field: EnrichmentOutcome["fieldErrors"][number]["field"],
  result: AppleAdsResult<T>,
): void {
  if (result.status === "error") {
    errors.push({ field, statusCode: result.statusCode, message: result.message });
  }
}

function firstAuthError<T>(result: AppleAdsResult<T>): string | undefined {
  return result.status === "auth_error" ? result.message : undefined;
}
