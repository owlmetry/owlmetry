import { describe, it, expect } from "vitest";
import {
  mapRevenueCatAttributesToAttributionProperties,
  normalizeWebhookSubscriberAttributes,
} from "../utils/attribution/revenuecat.js";
import type { RevenueCatV2Attribute } from "../utils/revenuecat.js";
import { selectUnsetProps } from "../utils/user-properties.js";

function attr(name: string, value: string, updated_at = Date.now()): RevenueCatV2Attribute {
  return { object: "customer.attribute", name, value, updated_at };
}

describe("mapRevenueCatAttributesToAttributionProperties", () => {
  it("maps full ASA attribute set to owlmetry asa_* namespace", () => {
    const attrs: RevenueCatV2Attribute[] = [
      attr("$mediaSource", "Apple Search Ads"),
      attr("$campaign", "USA_main_keyword"),
      attr("$adGroup", "USA_broad_match"),
      attr("$ad", "Ad Seven"),
      attr("$keyword", "mockup creator"),
      attr("$attConsentStatus", "restricted"),
    ];
    expect(mapRevenueCatAttributesToAttributionProperties(attrs)).toEqual({
      attribution_source: "apple_search_ads",
      asa_campaign_name: "USA_main_keyword",
      asa_ad_group_name: "USA_broad_match",
      asa_ad_name: "Ad Seven",
      asa_keyword: "mockup creator",
    });
  });

  it("marks user as organic (attribution_source=none) when $mediaSource is absent", () => {
    // RC-known subscriber who wasn't attributed to ASA — treat as organic.
    // Mirrors the Swift SDK's "attribution: false" contract so the dashboard
    // shows a concrete label instead of blank.
    const attrs: RevenueCatV2Attribute[] = [
      attr("$campaign", "USA_main_keyword"),
      attr("$adGroup", "USA_broad_match"),
    ];
    expect(mapRevenueCatAttributesToAttributionProperties(attrs)).toEqual({
      attribution_source: "none",
    });
  });

  it("marks user as organic when attributes list is empty (no $mediaSource)", () => {
    expect(mapRevenueCatAttributesToAttributionProperties([])).toEqual({
      attribution_source: "none",
    });
  });

  it("returns empty object when $mediaSource is a different network (not organic, just untracked)", () => {
    // User was attributed to Meta — we don't track that network yet, so
    // don't misattribute them as organic. Leave the slot empty.
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

  it("selectUnsetProps filters out organic 'none' when SDK already wrote real attribution", () => {
    // Guards the contract: RC sync should NEVER downgrade an SDK-captured
    // attribution to organic. The mapper can emit a "none" candidate, but
    // selectUnsetProps at the caller drops it when the slot is already set.
    const mapped = mapRevenueCatAttributesToAttributionProperties([]);
    expect(mapped).toEqual({ attribution_source: "none" });

    const currentPropsFromSdk = { attribution_source: "apple_search_ads", asa_campaign_id: "111" };
    expect(selectUnsetProps(mapped, currentPropsFromSdk)).toEqual({});

    const unsetUser = {};
    expect(selectUnsetProps(mapped, unsetUser)).toEqual({ attribution_source: "none" });
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

  it("round-trips an organic webhook payload (no $mediaSource) to attribution_source=none", () => {
    const mapped = mapRevenueCatAttributesToAttributionProperties(
      normalizeWebhookSubscriberAttributes({}),
    );
    expect(mapped).toEqual({ attribution_source: "none" });
  });
});

describe("selectUnsetProps attribution_source upgrade", () => {
  it("upgrades attribution_source from 'none' to 'apple_search_ads' when RC surfaces $mediaSource later", () => {
    // The Sewing Patterns scenario: project was on RC's basic AdServices
    // integration → every user got tagged "none". Switching to Advanced
    // surfaces $mediaSource, and the upgrade must land on existing rows.
    const candidate = { attribution_source: "apple_search_ads", asa_campaign_name: "USA_main_keyword" };
    const current = { attribution_source: "none" };
    expect(selectUnsetProps(candidate, current)).toEqual({
      attribution_source: "apple_search_ads",
      asa_campaign_name: "USA_main_keyword",
    });
  });

  it("upgrades attribution_source even when asa_*_name slots are already set", () => {
    // A prior enrichment pass could have written asa_campaign_name from the
    // ASA Campaign Management API while attribution_source stayed "none".
    // Names stay put (existing-name guard), attribution_source still upgrades.
    const candidate = { attribution_source: "apple_search_ads", asa_campaign_name: "Renamed" };
    const current = { attribution_source: "none", asa_campaign_name: "USA_main_keyword" };
    expect(selectUnsetProps(candidate, current)).toEqual({
      attribution_source: "apple_search_ads",
    });
  });

  it("never downgrades attribution_source from 'apple_search_ads' to 'none'", () => {
    // Pins the existing direction: RC organic candidate must not stomp a
    // real attribution that the SDK or a prior sync wrote.
    expect(
      selectUnsetProps({ attribution_source: "none" }, { attribution_source: "apple_search_ads" }),
    ).toEqual({});
  });

  it("never overwrites 'apple_test_install' with anything", () => {
    // TestFlight fixture detection writes apple_test_install precisely so we
    // know not to look again — Apple's API never returns real data for these.
    expect(
      selectUnsetProps(
        { attribution_source: "apple_search_ads" },
        { attribution_source: "apple_test_install" },
      ),
    ).toEqual({});
  });

  it("no-op when both current and candidate are 'none'", () => {
    expect(
      selectUnsetProps({ attribution_source: "none" }, { attribution_source: "none" }),
    ).toEqual({});
  });

  it("the 'none' carve-out is scoped to attribution_source — other keys with literal 'none' stay blocked", () => {
    // Sanity check: don't generalise "none" into a magic string. A custom
    // user property with the literal value "none" must still be guarded.
    expect(
      selectUnsetProps({ some_other_key: "real" }, { some_other_key: "none" }),
    ).toEqual({});
  });
});
