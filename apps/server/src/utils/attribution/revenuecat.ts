import {
  ATTRIBUTION_SOURCE_PROPERTY,
  ATTRIBUTION_SOURCE_VALUES,
} from "@owlmetry/shared";
import type { RevenueCatV2Attribute } from "../revenuecat.js";

/**
 * RevenueCat exposes generic attribution attributes (`$mediaSource`,
 * `$campaign`, `$adGroup`, `$ad`, `$keyword`) on every ASA-attributed
 * customer — verified empirically for a non-subscribing user, so this is
 * not subscriber-gated. RC fills these server-side: it receives the
 * AdServices token via its SDK, resolves the numeric IDs from Apple's
 * AdServices Attribution API, then — when the project has RC's "Advanced"
 * Apple AdServices integration configured with ASA Campaign Management
 * API credentials — resolves those IDs to human-readable names via the
 * ASA Campaign Management API. Only the names surface as subscriber
 * attributes; the numeric IDs stay server-side at RC (confirmed via the
 * `ReservedSubscriberAttributes` enum in RC's purchases-ios source — no
 * `$iad*` keys exist).
 *
 * So RC's names are complementary to the numeric IDs the Swift SDK writes
 * via its live AdServices capture — same Apple entity, different
 * representation. Users caught by both sources end up with every `asa_*`
 * slot populated.
 *
 * Parity with our Apple Search Ads integration (per-project OAuth path):
 * the ASA integration resolves the same four name fields directly from
 * Apple's Campaign Management API. Either source is sufficient; both are
 * per-field-merged into `app_users.properties` without overwriting data
 * already there.
 *
 * Three-way mapping of `$mediaSource`:
 *   - `"Apple Search Ads"` → full ASA attribution (source + names).
 *   - absent → `attribution_source = "none"`. Mirrors the Swift SDK's
 *     "non-attributed install" contract so RC-known organic users show
 *     a concrete label in the dashboard instead of blank.
 *   - any other value (e.g. `"Facebook Ads"`) → empty map. User was
 *     attributed via a network we don't track yet; marking them as
 *     organic would be lying, so leave `attribution_source` unset.
 *
 * Adding Meta/Google later: match additional `$mediaSource` values and
 * map to their own property prefixes (`meta_*`, `google_*`).
 */

const RC_MEDIA_SOURCE_APPLE_SEARCH_ADS = "Apple Search Ads";

function findValue(attrs: RevenueCatV2Attribute[], name: string): string | undefined {
  const match = attrs.find((a) => a.name === name);
  if (!match) return undefined;
  const trimmed = match.value?.trim();
  return trimmed ? trimmed : undefined;
}

export function mapRevenueCatAttributesToAttributionProperties(
  attrs: RevenueCatV2Attribute[],
): Record<string, string> {
  const mediaSource = findValue(attrs, "$mediaSource");

  // No `$mediaSource` on record → treat as organic. Callers pass this
  // through `selectUnsetProps` so an existing SDK-captured attribution is
  // never overwritten.
  if (mediaSource === undefined) {
    return { [ATTRIBUTION_SOURCE_PROPERTY]: ATTRIBUTION_SOURCE_VALUES.none };
  }

  // Known networks we don't track yet (Facebook Ads, etc.) — leave slot
  // empty so the user isn't misattributed as organic.
  if (mediaSource !== RC_MEDIA_SOURCE_APPLE_SEARCH_ADS) {
    return {};
  }

  const props: Record<string, string> = {
    [ATTRIBUTION_SOURCE_PROPERTY]: ATTRIBUTION_SOURCE_VALUES.appleSearchAds,
  };

  const campaign = findValue(attrs, "$campaign");
  if (campaign) props.asa_campaign_name = campaign;

  const adGroup = findValue(attrs, "$adGroup");
  if (adGroup) props.asa_ad_group_name = adGroup;

  const ad = findValue(attrs, "$ad");
  if (ad) props.asa_ad_name = ad;

  const keyword = findValue(attrs, "$keyword");
  if (keyword) props.asa_keyword = keyword;

  return props;
}

/**
 * Webhook payloads deliver `subscriber_attributes` as a record keyed by
 * attribute name (with nested `{ value, updated_at_ms }`), rather than the
 * V2 API's list-of-objects shape. Flatten to the list shape so the main
 * mapper doesn't care which transport delivered the data.
 */
export function normalizeWebhookSubscriberAttributes(
  subscriberAttributes: Record<string, { value: string; updated_at_ms: number }>,
): RevenueCatV2Attribute[] {
  return Object.entries(subscriberAttributes).map(([name, attr]) => ({
    object: "customer.attribute" as const,
    name,
    value: attr.value,
    updated_at: attr.updated_at_ms,
  }));
}
