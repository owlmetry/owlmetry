import { describe, it, expect } from "vitest";
import {
  mapRevenueCatAttributesToAttributionProperties,
  normalizeWebhookSubscriberAttributes,
} from "../utils/attribution/revenuecat.js";
import type { RevenueCatV2Attribute } from "../utils/revenuecat.js";

function attr(name: string, value: string, updated_at = Date.now()): RevenueCatV2Attribute {
  return { object: "customer.attribute", name, value, updated_at };
}

describe("mapRevenueCatAttributesToAttributionProperties", () => {
  it("maps full ASA attribute set to owlmetry asa_* namespace", () => {
    const attrs: RevenueCatV2Attribute[] = [
      attr("$mediaSource", "Apple Search Ads"),
      attr("$campaign", "USA_main_keyword"),
      attr("$adGroup", "USA_broad_match"),
      attr("$keyword", "mockup creator"),
      attr("$attConsentStatus", "restricted"),
    ];
    expect(mapRevenueCatAttributesToAttributionProperties(attrs)).toEqual({
      attribution_source: "apple_search_ads",
      asa_campaign_name: "USA_main_keyword",
      asa_ad_group_name: "USA_broad_match",
      asa_keyword: "mockup creator",
    });
  });

  it("returns empty object when $mediaSource is absent", () => {
    const attrs: RevenueCatV2Attribute[] = [
      attr("$campaign", "USA_main_keyword"),
      attr("$adGroup", "USA_broad_match"),
    ];
    expect(mapRevenueCatAttributesToAttributionProperties(attrs)).toEqual({});
  });

  it("returns empty object when $mediaSource is a different network", () => {
    const attrs: RevenueCatV2Attribute[] = [
      attr("$mediaSource", "Facebook Ads"),
      attr("$campaign", "meta_xyz"),
    ];
    expect(mapRevenueCatAttributesToAttributionProperties(attrs)).toEqual({});
  });

  it("only sets attribution_source when all name fields are empty", () => {
    const attrs: RevenueCatV2Attribute[] = [
      attr("$mediaSource", "Apple Search Ads"),
    ];
    expect(mapRevenueCatAttributesToAttributionProperties(attrs)).toEqual({
      attribution_source: "apple_search_ads",
    });
  });

  it("trims whitespace and drops empty-after-trim values", () => {
    const attrs: RevenueCatV2Attribute[] = [
      attr("$mediaSource", "Apple Search Ads"),
      attr("$campaign", "  padded_name  "),
      attr("$adGroup", "   "),
      attr("$keyword", ""),
    ];
    expect(mapRevenueCatAttributesToAttributionProperties(attrs)).toEqual({
      attribution_source: "apple_search_ads",
      asa_campaign_name: "padded_name",
    });
  });

  it("is safe on empty input", () => {
    expect(mapRevenueCatAttributesToAttributionProperties([])).toEqual({});
  });
});

describe("normalizeWebhookSubscriberAttributes", () => {
  it("flattens the record-of-attributes webhook shape into the V2 list shape", () => {
    const now = 1700000000000;
    const out = normalizeWebhookSubscriberAttributes({
      "$mediaSource": { value: "Apple Search Ads", updated_at_ms: now },
      "$campaign": { value: "camp_one", updated_at_ms: now + 1 },
    });
    expect(out).toEqual([
      { object: "customer.attribute", name: "$mediaSource", value: "Apple Search Ads", updated_at: now },
      { object: "customer.attribute", name: "$campaign", value: "camp_one", updated_at: now + 1 },
    ]);
  });

  it("round-trips through the main mapper so webhook + V2 produce identical output", () => {
    const now = 1700000000000;
    const webhookShape = {
      "$mediaSource": { value: "Apple Search Ads", updated_at_ms: now },
      "$campaign": { value: "camp", updated_at_ms: now },
      "$adGroup": { value: "adgroup", updated_at_ms: now },
      "$keyword": { value: "kw", updated_at_ms: now },
    };
    const mapped = mapRevenueCatAttributesToAttributionProperties(
      normalizeWebhookSubscriberAttributes(webhookShape),
    );
    expect(mapped).toEqual({
      attribution_source: "apple_search_ads",
      asa_campaign_name: "camp",
      asa_ad_group_name: "adgroup",
      asa_keyword: "kw",
    });
  });
});
