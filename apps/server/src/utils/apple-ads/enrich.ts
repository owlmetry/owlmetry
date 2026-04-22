import { ASA_ID_NAME_PAIRS } from "@owlmetry/shared";
import type { AppleAdsConfig } from "./config.js";
import {
  getAppleAdsCampaign,
  getAppleAdsAdGroup,
  getAppleAdsTargetingKeyword,
  getAppleAdsAd,
  type AppleAdsResult,
  type AppleAdsCampaign,
  type AppleAdsAdGroup,
  type AppleAdsTargetingKeyword,
  type AppleAdsAd,
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
export type EnrichmentField = "campaign" | "ad_group" | "keyword" | "ad";

export interface EnrichmentOutcome {
  props: Record<string, string>;
  /** First auth/config error encountered, if any — aborts the rest of the call. */
  authError?: string;
  /** Non-fatal per-field errors (5xx, network), for telemetry. */
  fieldErrors: Array<{ field: EnrichmentField; statusCode: number; message: string }>;
}

/**
 * Per-run memoization for the four Campaign Management API endpoints. A single
 * bulk sync over 10k users attributed to the same 3 campaigns collapses from
 * 40k API calls to ~30. Pass an instance into `enrichAppleAdsNames` from a
 * bulk loop; omit it for single-user enrichment.
 *
 * Only `found` and `not_found` results are cached — transient 5xx/network
 * errors should be retried on the next user.
 */
export class AppleAdsLookupCache {
  private campaigns = new Map<string, AppleAdsResult<AppleAdsCampaign>>();
  private adGroups = new Map<string, AppleAdsResult<AppleAdsAdGroup>>();
  private keywords = new Map<string, AppleAdsResult<AppleAdsTargetingKeyword>>();
  private ads = new Map<string, AppleAdsResult<AppleAdsAd>>();

  async getCampaign(config: AppleAdsConfig, id: string) {
    return this.memoize(this.campaigns, id, () => getAppleAdsCampaign(config, id));
  }
  async getAdGroup(config: AppleAdsConfig, campaignId: string, adGroupId: string) {
    return this.memoize(this.adGroups, `${campaignId}:${adGroupId}`, () =>
      getAppleAdsAdGroup(config, campaignId, adGroupId),
    );
  }
  async getKeyword(config: AppleAdsConfig, campaignId: string, adGroupId: string, keywordId: string) {
    return this.memoize(this.keywords, `${campaignId}:${adGroupId}:${keywordId}`, () =>
      getAppleAdsTargetingKeyword(config, campaignId, adGroupId, keywordId),
    );
  }
  async getAd(config: AppleAdsConfig, campaignId: string, adGroupId: string, adId: string) {
    return this.memoize(this.ads, `${campaignId}:${adGroupId}:${adId}`, () =>
      getAppleAdsAd(config, campaignId, adGroupId, adId),
    );
  }

  private async memoize<T>(
    cache: Map<string, AppleAdsResult<T>>,
    key: string,
    fetch: () => Promise<AppleAdsResult<T>>,
  ): Promise<AppleAdsResult<T>> {
    const hit = cache.get(key);
    if (hit) return hit;
    const result = await fetch();
    if (result.status === "found" || result.status === "not_found") {
      cache.set(key, result);
    }
    return result;
  }
}

export async function enrichAppleAdsNames(
  config: AppleAdsConfig,
  existingProps: Record<string, unknown>,
  cache?: AppleAdsLookupCache,
): Promise<EnrichmentOutcome> {
  const campaignId = pickIdString(existingProps, "asa_campaign_id");
  if (!campaignId) {
    return { props: {}, fieldErrors: [] };
  }

  const adGroupId = pickIdString(existingProps, "asa_ad_group_id");
  const keywordId = pickIdString(existingProps, "asa_keyword_id");
  const adId = pickIdString(existingProps, "asa_ad_id");

  // Run the campaign call first — it acts as an auth gate. If credentials are
  // bad we return immediately without wasting three parallel calls on the
  // same 403.
  const campaignRes = cache
    ? await cache.getCampaign(config, campaignId)
    : await getAppleAdsCampaign(config, campaignId);
  if (campaignRes.status === "auth_error") {
    return { props: {}, authError: campaignRes.message, fieldErrors: [] };
  }

  // Ad group / keyword / ad lookups all take params we already have and don't
  // depend on the campaign response — run them concurrently.
  const [adGroupRes, keywordRes, adRes] = await Promise.all([
    adGroupId
      ? (cache ? cache.getAdGroup(config, campaignId, adGroupId) : getAppleAdsAdGroup(config, campaignId, adGroupId))
      : Promise.resolve(null),
    adGroupId && keywordId
      ? (cache
          ? cache.getKeyword(config, campaignId, adGroupId, keywordId)
          : getAppleAdsTargetingKeyword(config, campaignId, adGroupId, keywordId))
      : Promise.resolve(null),
    adGroupId && adId
      ? (cache ? cache.getAd(config, campaignId, adGroupId, adId) : getAppleAdsAd(config, campaignId, adGroupId, adId))
      : Promise.resolve(null),
  ]);

  const props: Record<string, string> = {};
  const fieldErrors: EnrichmentOutcome["fieldErrors"] = [];

  captureName(props, nameKeyFor("asa_campaign_id"), campaignRes, (d) => d.name);
  captureFieldError(fieldErrors, "campaign", campaignRes);

  if (adGroupRes) {
    if (adGroupRes.status === "auth_error") return { props, authError: adGroupRes.message, fieldErrors };
    captureName(props, nameKeyFor("asa_ad_group_id"), adGroupRes, (d) => d.name);
    captureFieldError(fieldErrors, "ad_group", adGroupRes);
  }
  if (keywordRes) {
    if (keywordRes.status === "auth_error") return { props, authError: keywordRes.message, fieldErrors };
    captureName(props, nameKeyFor("asa_keyword_id"), keywordRes, (d) => d.text);
    captureFieldError(fieldErrors, "keyword", keywordRes);
  }
  if (adRes) {
    if (adRes.status === "auth_error") return { props, authError: adRes.message, fieldErrors };
    captureName(props, nameKeyFor("asa_ad_id"), adRes, (d) => d.name);
    captureFieldError(fieldErrors, "ad", adRes);
  }

  return { props, fieldErrors };
}

/**
 * Build a diagnostic patch recording the last enrichment outcome on the
 * user's properties. Stored under a `_asa_enrichment_*` namespace so it's
 * easy to find for one user but easy to filter out of the main UI. Complements
 * the `job_runs` aggregate counters and the pm2 server logs — makes "why
 * doesn't user X have a campaign name?" a one-row answer.
 *
 * Callers pass `unsetPropsAboutToWrite` so `success` vs `no_changes` can be
 * distinguished (the enrichment helper returns the same `props` shape whether
 * or not the DB already had those names).
 */
export type EnrichmentDiagnosticStatus =
  | "success"
  | "no_changes"
  | "not_found"
  | "upstream_error"
  | "auth_error";

export function buildEnrichmentDiagnostic(
  outcome: EnrichmentOutcome,
  unsetPropsAboutToWrite: number,
): Record<string, string> {
  const now = new Date().toISOString();
  // Always clear the error slot unless we have a new one — otherwise stale
  // error text would outlive the problem.
  const base: Record<string, string> = {
    _asa_enrichment_last_at: now,
    _asa_enrichment_last_error: "",
  };

  if (outcome.authError) {
    return {
      ...base,
      _asa_enrichment_last_outcome: "auth_error",
      _asa_enrichment_last_error: truncate(outcome.authError, 200),
    };
  }
  if (outcome.fieldErrors.length > 0) {
    const fe = outcome.fieldErrors[0];
    return {
      ...base,
      _asa_enrichment_last_outcome: "upstream_error",
      _asa_enrichment_last_error: truncate(`${fe.field} ${fe.statusCode}: ${fe.message}`, 200),
    };
  }
  if (unsetPropsAboutToWrite > 0) {
    return { ...base, _asa_enrichment_last_outcome: "success" };
  }
  if (Object.keys(outcome.props).length === 0) {
    // Enrichment ran but Apple returned no name for any of the IDs — either
    // the campaign/ad group/etc. has been archived or we're looking up IDs
    // from a different Apple org than the one the credentials own.
    return { ...base, _asa_enrichment_last_outcome: "not_found" };
  }
  return { ...base, _asa_enrichment_last_outcome: "no_changes" };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function nameKeyFor(idKey: string): string {
  const pair = ASA_ID_NAME_PAIRS.find((p) => p.idKey === idKey);
  if (!pair) throw new Error(`no name key mapping for ${idKey}`);
  return pair.nameKey;
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
  field: EnrichmentField,
  result: AppleAdsResult<T>,
): void {
  if (result.status === "error") {
    errors.push({ field, statusCode: result.statusCode, message: result.message });
  }
}
