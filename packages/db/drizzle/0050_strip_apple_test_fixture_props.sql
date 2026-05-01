-- Backfill: convert Apple's non-production attribution fixture from
-- "apple_search_ads with placeholder asa_* IDs" to "apple_test_install with
-- no asa_* fields" on app_users that already received the fixture before the
-- server learned to short-circuit it.
--
-- Apple's AdServices API deliberately returns a fixed dummy payload (same
-- numeric ID across campaign/ad_group/ad, e.g. 1234567890; keyword 12323222;
-- claimType "Click") for TestFlight, Xcode dev builds, and the simulator —
-- see apps/server/src/utils/attribution/apple-search-ads.ts. Storing those IDs
-- conflates test installs with real ASA-attributed users on every dashboard,
-- so we strip them and promote the install to a first-class
-- attribution_source value the UI can render distinctly from organic.
--
-- Match condition: either (a) the legacy `likely_app_reviewer` flag was set
-- by the previous version of the resolver, or (b) the row carries the
-- structural three-way ID equality that real Apple data can never produce.
UPDATE app_users
SET properties =
  (properties
    - 'asa_campaign_id'
    - 'asa_ad_group_id'
    - 'asa_ad_id'
    - 'asa_keyword_id'
    - 'asa_claim_type'
    - 'asa_creative_set_id'
    - 'asa_campaign_name'
    - 'asa_ad_group_name'
    - 'asa_ad_name'
    - 'asa_keyword'
    - 'likely_app_reviewer')
  || jsonb_build_object('attribution_source', 'apple_test_install')
WHERE properties->>'likely_app_reviewer' = 'true'
   OR (
     properties->>'attribution_source' = 'apple_search_ads'
     AND properties ? 'asa_campaign_id'
     AND properties ? 'asa_ad_group_id'
     AND properties ? 'asa_ad_id'
     AND properties->>'asa_campaign_id' = properties->>'asa_ad_group_id'
     AND properties->>'asa_ad_group_id' = properties->>'asa_ad_id'
   );
