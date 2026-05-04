import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_DB_URL,
} from "./setup.js";
import { reconcileAppleAdsLifetimeNames } from "../utils/apple-ads/reconcile.js";

let app: FastifyInstance;
let projectId: string;
let appId: string;
let teamId: string;

const sql = postgres(TEST_DB_URL, { max: 1 });

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  projectId = seed.projectId;
  appId = seed.appId;
  teamId = seed.teamId;
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

async function insertUser(userId: string, props: Record<string, string>) {
  await sql`
    INSERT INTO app_users (project_id, user_id, is_anonymous, properties)
    VALUES (${projectId}, ${userId}, false, ${sql.json(props)})
  `;
}

async function insertCampaignLifetime(campaignId: string, name: string | null) {
  await sql`
    INSERT INTO ad_campaign_lifetime
      (team_id, project_id, app_id, apple_app_store_id, network, campaign_id, campaign_name, last_synced_at)
    VALUES
      (${teamId}, ${projectId}, ${appId}, 12345, 'apple_search_ads', ${campaignId}, ${name}, NOW())
  `;
}

async function insertAdGroupLifetime(campaignId: string, adGroupId: string, name: string | null) {
  await sql`
    INSERT INTO ad_adgroup_lifetime
      (team_id, project_id, app_id, network, campaign_id, ad_group_id, ad_group_name, last_synced_at)
    VALUES
      (${teamId}, ${projectId}, ${appId}, 'apple_search_ads', ${campaignId}, ${adGroupId}, ${name}, NOW())
  `;
}

async function readProps(userId: string): Promise<Record<string, string>> {
  const [row] = await sql<{ properties: Record<string, string> }[]>`
    SELECT properties FROM app_users
    WHERE project_id = ${projectId} AND user_id = ${userId}
  `;
  return row.properties;
}

describe("reconcileAppleAdsLifetimeNames", () => {
  it("refreshes a stale ad group name when the lifetime table has a newer one", async () => {
    await insertUser("u1", {
      attribution_source: "apple_search_ads",
      asa_campaign_id: "100",
      asa_campaign_name: "other_countries_main_keywords",
      asa_ad_group_id: "200",
      asa_ad_group_name: "usa_main_keywords",
    });
    await insertCampaignLifetime("100", "other_countries_main_keywords");
    await insertAdGroupLifetime("100", "200", "other_countries_main_keywords");

    const result = await reconcileAppleAdsLifetimeNames(app.db, projectId);

    expect(result.ad_group_names_refreshed).toBe(1);
    expect(result.campaign_names_refreshed).toBe(0);
    const props = await readProps("u1");
    expect(props.asa_ad_group_name).toBe("other_countries_main_keywords");
    expect(props.asa_campaign_name).toBe("other_countries_main_keywords");
  });

  it("refreshes a stale campaign name", async () => {
    await insertUser("u1", {
      attribution_source: "apple_search_ads",
      asa_campaign_id: "100",
      asa_campaign_name: "Old Campaign",
    });
    await insertCampaignLifetime("100", "New Campaign");

    const result = await reconcileAppleAdsLifetimeNames(app.db, projectId);

    expect(result.campaign_names_refreshed).toBe(1);
    const props = await readProps("u1");
    expect(props.asa_campaign_name).toBe("New Campaign");
  });

  it("is a no-op when names already match", async () => {
    await insertUser("u1", {
      attribution_source: "apple_search_ads",
      asa_campaign_id: "100",
      asa_campaign_name: "Campaign",
      asa_ad_group_id: "200",
      asa_ad_group_name: "Ad Group",
    });
    await insertCampaignLifetime("100", "Campaign");
    await insertAdGroupLifetime("100", "200", "Ad Group");

    const result = await reconcileAppleAdsLifetimeNames(app.db, projectId);

    expect(result.campaign_names_refreshed).toBe(0);
    expect(result.ad_group_names_refreshed).toBe(0);
  });

  it("does not touch users whose ad group is no longer in the lifetime table (deleted on Apple's side)", async () => {
    await insertUser("u1", {
      attribution_source: "apple_search_ads",
      asa_campaign_id: "100",
      asa_ad_group_id: "999",
      asa_ad_group_name: "archived_ad_group",
    });
    // No ad_adgroup_lifetime row for ad group 999.

    const result = await reconcileAppleAdsLifetimeNames(app.db, projectId);

    expect(result.ad_group_names_refreshed).toBe(0);
    const props = await readProps("u1");
    expect(props.asa_ad_group_name).toBe("archived_ad_group");
  });

  it("skips lifetime rows with a null name (don't blank out user properties)", async () => {
    await insertUser("u1", {
      attribution_source: "apple_search_ads",
      asa_campaign_id: "100",
      asa_campaign_name: "Existing Name",
    });
    await insertCampaignLifetime("100", null);

    const result = await reconcileAppleAdsLifetimeNames(app.db, projectId);

    expect(result.campaign_names_refreshed).toBe(0);
    const props = await readProps("u1");
    expect(props.asa_campaign_name).toBe("Existing Name");
  });

  it("scopes updates to the requested project", async () => {
    // Seed a second project under the same team with a same-numbered campaign
    // that has a DIFFERENT current name. Reconciling project A must not touch
    // users under project B.
    const [other] = await sql<{ id: string }[]>`
      INSERT INTO projects (team_id, name, slug, color)
      VALUES (${teamId}, 'Other Project', 'other-project', '#ff00ff')
      RETURNING id
    `;
    const otherProjectId = other.id;
    const [otherApp] = await sql<{ id: string }[]>`
      INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
      VALUES (${teamId}, ${otherProjectId}, 'Other App', 'apple', 'com.test.other')
      RETURNING id
    `;

    await insertUser("u_a", {
      attribution_source: "apple_search_ads",
      asa_campaign_id: "100",
      asa_campaign_name: "stale-a",
    });
    await sql`
      INSERT INTO app_users (project_id, user_id, is_anonymous, properties)
      VALUES (${otherProjectId}, 'u_b', false, ${sql.json({
        attribution_source: "apple_search_ads",
        asa_campaign_id: "100",
        asa_campaign_name: "stale-b",
      })})
    `;

    await insertCampaignLifetime("100", "current-a");
    await sql`
      INSERT INTO ad_campaign_lifetime
        (team_id, project_id, app_id, apple_app_store_id, network, campaign_id, campaign_name, last_synced_at)
      VALUES
        (${teamId}, ${otherProjectId}, ${otherApp.id}, 99999, 'apple_search_ads', '100', 'current-b', NOW())
    `;

    const result = await reconcileAppleAdsLifetimeNames(app.db, projectId);

    expect(result.campaign_names_refreshed).toBe(1);
    expect((await readProps("u_a")).asa_campaign_name).toBe("current-a");
    const [other_user] = await sql<{ properties: Record<string, string> }[]>`
      SELECT properties FROM app_users
      WHERE project_id = ${otherProjectId} AND user_id = 'u_b'
    `;
    expect(other_user.properties.asa_campaign_name).toBe("stale-b");
  });

  it("refreshes many users in a single statement", async () => {
    // The phantom-row scenario: 18 users with a stale ad group name, all
    // pointing at the same numeric ad group ID that was renamed on Apple.
    const userCount = 18;
    for (let i = 0; i < userCount; i++) {
      await insertUser(`u${i}`, {
        attribution_source: "apple_search_ads",
        asa_campaign_id: "100",
        asa_campaign_name: "other_countries_main_keywords",
        asa_ad_group_id: "200",
        asa_ad_group_name: "usa_main_keywords",
      });
    }
    await insertCampaignLifetime("100", "other_countries_main_keywords");
    await insertAdGroupLifetime("100", "200", "other_countries_main_keywords");

    const result = await reconcileAppleAdsLifetimeNames(app.db, projectId);

    expect(result.ad_group_names_refreshed).toBe(userCount);
    for (let i = 0; i < userCount; i++) {
      const props = await readProps(`u${i}`);
      expect(props.asa_ad_group_name).toBe("other_countries_main_keywords");
    }
  });
});
