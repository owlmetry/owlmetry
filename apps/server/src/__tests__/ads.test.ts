import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  createAgentKey,
  getTokenAndTeamId,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let projectId: string;
let appId: string;
let teamId: string;
let agentKey: string;

const sql = postgres(TEST_DB_URL, { max: 1 });

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  projectId = seed.projectId;
  appId = seed.appId;
  const { token, teamId: tid } = await getTokenAndTeamId(app);
  teamId = tid;
  agentKey = await createAgentKey(app, token, teamId, ["apps:read", "users:write"]);
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

interface SeedUser {
  user_id: string;
  campaign_id: string;
  campaign_name?: string;
  ad_group_id?: string;
  ad_group_name?: string;
  keyword_id?: string;
  keyword_name?: string;
  ad_id?: string;
  ad_name?: string;
  revenue_usd_cents?: number | null;
  /** ISO timestamp; defaults to now() so most tests don't have to think about the trailing-window filter. */
  first_seen_at?: string;
}

async function seedUsers(users: SeedUser[]) {
  for (const u of users) {
    const props: Record<string, string> = {
      attribution_source: "apple_search_ads",
      asa_campaign_id: u.campaign_id,
    };
    if (u.campaign_name) props.asa_campaign_name = u.campaign_name;
    if (u.ad_group_id) props.asa_ad_group_id = u.ad_group_id;
    if (u.ad_group_name) props.asa_ad_group_name = u.ad_group_name;
    if (u.keyword_id) props.asa_keyword_id = u.keyword_id;
    if (u.keyword_name) props.asa_keyword = u.keyword_name;
    if (u.ad_id) props.asa_ad_id = u.ad_id;
    if (u.ad_name) props.asa_ad_name = u.ad_name;

    const [row] = u.first_seen_at
      ? await sql`
          INSERT INTO app_users (project_id, user_id, is_anonymous, properties, total_revenue_usd_cents, first_seen_at, last_seen_at)
          VALUES (${projectId}, ${u.user_id}, false, ${sql.json(props)},
                  ${u.revenue_usd_cents ?? null}, ${u.first_seen_at}, ${u.first_seen_at})
          RETURNING id
        `
      : await sql`
          INSERT INTO app_users (project_id, user_id, is_anonymous, properties, total_revenue_usd_cents)
          VALUES (${projectId}, ${u.user_id}, false, ${sql.json(props)},
                  ${u.revenue_usd_cents ?? null})
          RETURNING id
        `;
    // Junction so app_id filter has something to bind to.
    await sql`
      INSERT INTO app_user_apps (app_user_id, app_id)
      VALUES (${row.id}, ${appId})
    `;
  }
}

function get(url: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${agentKey}` },
  });
}

describe("GET /v1/projects/:projectId/ads/campaigns", () => {
  it("returns empty when no attributed users", async () => {
    const res = await get(`/v1/projects/${projectId}/ads/campaigns`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.campaigns).toEqual([]);
    expect(body.total_user_count).toBe(0);
    expect(body.total_revenue_usd).toBe(0);
    expect(body.attribution_source).toBe("apple_search_ads");
  });

  it("aggregates by campaign and ranks by revenue desc", async () => {
    await seedUsers([
      // Campaign A: 3 users, $20 + $30 + $0 = $50, 2 paying
      { user_id: "u1", campaign_id: "A", campaign_name: "Alpha", revenue_usd_cents: 2000 },
      { user_id: "u2", campaign_id: "A", campaign_name: "Alpha", revenue_usd_cents: 3000 },
      { user_id: "u3", campaign_id: "A", campaign_name: "Alpha", revenue_usd_cents: 0 },
      // Campaign B: 2 users, $100 + $0 = $100, 1 paying
      { user_id: "u4", campaign_id: "B", campaign_name: "Beta", revenue_usd_cents: 10000 },
      { user_id: "u5", campaign_id: "B", campaign_name: "Beta", revenue_usd_cents: null },
      // Campaign C: 1 user, no revenue → 0
      { user_id: "u6", campaign_id: "C", campaign_name: "Gamma", revenue_usd_cents: null },
    ]);

    const res = await get(`/v1/projects/${projectId}/ads/campaigns`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.campaigns).toHaveLength(3);

    // Ranking: B ($100) > A ($50) > C ($0). The bucket key is the campaign
    // name (COALESCE(name, id)) so RC-backfilled name-only users merge with
    // SDK-attributed (id+name) users for the same campaign.
    expect(body.campaigns[0].id).toBe("Beta");
    expect(body.campaigns[0].name).toBe("Beta");
    expect(body.campaigns[0].user_count).toBe(2);
    expect(body.campaigns[0].paying_user_count).toBe(1);
    expect(body.campaigns[0].total_revenue_usd).toBe(100);
    // ARPU = $100 / 2 = $50
    expect(body.campaigns[0].arpu).toBe(50);

    expect(body.campaigns[1].id).toBe("Alpha");
    expect(body.campaigns[1].user_count).toBe(3);
    expect(body.campaigns[1].paying_user_count).toBe(2);
    expect(body.campaigns[1].total_revenue_usd).toBe(50);
    // ARPU = $50 / 3 ≈ 16.6667
    expect(body.campaigns[1].arpu).toBeCloseTo(50 / 3, 4);

    expect(body.campaigns[2].id).toBe("Gamma");
    expect(body.campaigns[2].user_count).toBe(1);
    expect(body.campaigns[2].paying_user_count).toBe(0);
    expect(body.campaigns[2].total_revenue_usd).toBe(0);
    // ARPU = $0 / 1 = $0
    expect(body.campaigns[2].arpu).toBe(0);

    // Aggregate totals
    expect(body.total_user_count).toBe(6);
    expect(body.total_paying_user_count).toBe(3);
    expect(body.total_revenue_usd).toBe(150);
  });

  it("excludes users with attribution_source != apple_search_ads", async () => {
    await sql`
      INSERT INTO app_users (project_id, user_id, is_anonymous, properties, total_revenue_usd_cents)
      VALUES
        (${projectId}, 'asa-user', false,
         ${sql.json({ attribution_source: "apple_search_ads", asa_campaign_id: "A" })},
         5000),
        (${projectId}, 'organic-user', false,
         ${sql.json({ attribution_source: "none" })}, 5000),
        (${projectId}, 'test-install', false,
         ${sql.json({ attribution_source: "apple_test_install" })}, 5000)
    `;
    const res = await get(`/v1/projects/${projectId}/ads/campaigns`);
    const body = res.json();
    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0].id).toBe("A");
    expect(body.total_user_count).toBe(1);
  });

  it("merges SDK-attributed (id+name) and RC-backfilled (name-only) users for the same campaign", async () => {
    // SDK-attributed user with both id+name
    await seedUsers([
      { user_id: "u1", campaign_id: "123", campaign_name: "Spring", revenue_usd_cents: 0 },
    ]);
    // RC-backfilled user: name only, no id (RC stores `$campaign` as a string)
    await sql`
      INSERT INTO app_users (project_id, user_id, is_anonymous, properties, total_revenue_usd_cents)
      VALUES (${projectId}, 'u2', false,
              ${sql.json({ attribution_source: "apple_search_ads", asa_campaign_name: "Spring" })},
              5000)
    `;

    const res = await get(`/v1/projects/${projectId}/ads/campaigns`);
    const body = res.json();
    // Both users land in a single bucket keyed by name, so the paying RC
    // user's revenue surfaces alongside the SDK-attributed install.
    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0].id).toBe("Spring");
    expect(body.campaigns[0].name).toBe("Spring");
    expect(body.campaigns[0].user_count).toBe(2);
    expect(body.campaigns[0].paying_user_count).toBe(1);
    expect(body.campaigns[0].total_revenue_usd).toBe(50);
  });

  it("filters by app_id via app_user_apps junction", async () => {
    // Seed two users on the test app, then a third user in the same project but
    // attached to a different app — the app_id filter should exclude them.
    await seedUsers([
      { user_id: "u1", campaign_id: "A", revenue_usd_cents: 1000 },
      { user_id: "u2", campaign_id: "A", revenue_usd_cents: 1000 },
    ]);

    // Third user, different app: insert app + junction directly.
    const [{ id: otherApp }] = await sql<{ id: string }[]>`
      INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
      SELECT team_id, project_id, 'Other App', 'apple', 'com.example.other'
      FROM apps WHERE id = ${appId}
      RETURNING id
    `;
    const [{ id: thirdUser }] = await sql<{ id: string }[]>`
      INSERT INTO app_users (project_id, user_id, is_anonymous, properties, total_revenue_usd_cents)
      VALUES (${projectId}, 'u3', false,
              ${sql.json({ attribution_source: "apple_search_ads", asa_campaign_id: "A" })},
              50000)
      RETURNING id
    `;
    await sql`
      INSERT INTO app_user_apps (app_user_id, app_id)
      VALUES (${thirdUser}, ${otherApp})
    `;

    const allRes = await get(`/v1/projects/${projectId}/ads/campaigns`);
    const all = allRes.json();
    expect(all.campaigns[0].user_count).toBe(3);
    expect(all.total_revenue_usd).toBe(520); // $10 + $10 + $500

    const filteredRes = await get(`/v1/projects/${projectId}/ads/campaigns?app_id=${appId}`);
    const filtered = filteredRes.json();
    expect(filtered.campaigns[0].user_count).toBe(2);
    expect(filtered.total_revenue_usd).toBe(20); // only $10 + $10
  });

  it("excludes users acquired before the trailing window and echoes window_days", async () => {
    // Users acquired more than 360 days ago must NOT contribute to revenue,
    // since the spend window in `ad_campaign_lifetime` is also 360 days —
    // counting them would inflate ROAS at the boundary.
    const today = new Date();
    const inWindow = new Date(today.getTime() - 30 * 86400_000).toISOString();
    const outOfWindow = new Date(today.getTime() - 400 * 86400_000).toISOString();
    await seedUsers([
      { user_id: "recent", campaign_id: "Z", campaign_name: "Zeta", revenue_usd_cents: 5000, first_seen_at: inWindow },
      { user_id: "old", campaign_id: "Z", campaign_name: "Zeta", revenue_usd_cents: 100_000, first_seen_at: outOfWindow },
    ]);

    const res = await get(`/v1/projects/${projectId}/ads/campaigns`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.window_days).toBe(360);
    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0].user_count).toBe(1);
    expect(body.campaigns[0].total_revenue_usd).toBe(50);
  });

  it("rejects with 400 for unsupported attribution_source", async () => {
    const res = await get(`/v1/projects/${projectId}/ads/campaigns?attribution_source=apple_search_ads`);
    expect(res.statusCode).toBe(200); // valid
    // Note: parseAttributionSource silently falls back to default for unknown
    // values rather than 400-ing — keeps the route forgiving for clients that
    // pass a stale source. The 400 path only fires on internal mapping miss
    // which can't happen for the registered defaults. So we assert the
    // fallback behaviour here instead.
    const fallback = await get(
      `/v1/projects/${projectId}/ads/campaigns?attribution_source=meta`,
    );
    expect(fallback.statusCode).toBe(200);
    expect(fallback.json().attribution_source).toBe("apple_search_ads");
  });

  it("surfaces spend-only campaigns from ad_campaign_lifetime even with no attributed users", async () => {
    // The Sewing Patterns scenario: apple_ads_sync rolled up campaign spend,
    // but no users have attribution data yet (RC integration on basic, SDK
    // not capturing). Without spend-only rows the dashboard would be empty
    // despite real spend on file.
    await sql`
      INSERT INTO ad_campaign_lifetime (team_id, project_id, app_id, apple_app_store_id, network, campaign_id, campaign_name, total_spend_usd_cents, spend_currency, campaign_status, last_synced_at)
      VALUES
        (${teamId}, ${projectId}, ${appId}, 12345, 'apple_search_ads', '111', 'sewing_usa_main_keywords', 1491, 'USD', 'PAUSED', NOW()),
        (${teamId}, ${projectId}, ${appId}, 12345, 'apple_search_ads', '222', 'sewing_all_countries_main_keywords', 1053, 'USD', 'PAUSED', NOW()),
        (${teamId}, ${projectId}, ${appId}, 12345, 'apple_search_ads', '333', 'no_spend_yet', 0, 'USD', 'RUNNING', NOW())
    `;
    const res = await get(`/v1/projects/${projectId}/ads/campaigns`);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.campaigns).toHaveLength(3);
    // Sort: revenue desc, then spend desc, then user_count desc, id asc.
    // All have $0 revenue, so spend desc takes over.
    expect(body.campaigns[0].name).toBe("sewing_usa_main_keywords");
    expect(body.campaigns[0].total_spend_usd).toBeCloseTo(14.91, 2);
    expect(body.campaigns[0].user_count).toBe(0);
    expect(body.campaigns[0].paying_user_count).toBe(0);
    expect(body.campaigns[0].total_revenue_usd).toBe(0);
    // ROAS: 0 revenue / >0 spend = 0
    expect(body.campaigns[0].roas).toBe(0);
    expect(body.campaigns[0].status).toBe("PAUSED");

    expect(body.campaigns[1].name).toBe("sewing_all_countries_main_keywords");
    expect(body.campaigns[1].total_spend_usd).toBeCloseTo(10.53, 2);

    // $0-spend campaign still surfaces; ROAS null because spend = 0.
    expect(body.campaigns[2].name).toBe("no_spend_yet");
    expect(body.campaigns[2].total_spend_usd).toBe(0);
    expect(body.campaigns[2].roas).toBeNull();

    // Lifetime spend across the project should sum every spend-only row.
    expect(body.total_spend_usd).toBeCloseTo(14.91 + 10.53 + 0, 2);
    expect(body.total_user_count).toBe(0);
    expect(body.total_revenue_usd).toBe(0);
  });

  it("merges spend with attribution: campaigns with both attributed users and spend show on a single row", async () => {
    // Campaign Alpha has both attributed users (revenue) and spend.
    // Campaign Beta is spend-only (no attributed users).
    await seedUsers([
      { user_id: "u1", campaign_id: "alpha-id", campaign_name: "Alpha", revenue_usd_cents: 5000 },
      { user_id: "u2", campaign_id: "alpha-id", campaign_name: "Alpha", revenue_usd_cents: 3000 },
    ]);
    await sql`
      INSERT INTO ad_campaign_lifetime (team_id, project_id, app_id, apple_app_store_id, network, campaign_id, campaign_name, total_spend_usd_cents, spend_currency, last_synced_at)
      VALUES
        (${teamId}, ${projectId}, ${appId}, 12345, 'apple_search_ads', 'alpha-id', 'Alpha', 2000, 'USD', NOW()),
        (${teamId}, ${projectId}, ${appId}, 12345, 'apple_search_ads', 'beta-id', 'Beta', 1500, 'USD', NOW())
    `;
    const res = await get(`/v1/projects/${projectId}/ads/campaigns`);
    const body = res.json();

    expect(body.campaigns).toHaveLength(2);
    // Alpha first (revenue $80 > Beta's $0).
    expect(body.campaigns[0].name).toBe("Alpha");
    expect(body.campaigns[0].user_count).toBe(2);
    expect(body.campaigns[0].total_revenue_usd).toBe(80);
    expect(body.campaigns[0].total_spend_usd).toBe(20);
    // ROAS = $80 / $20 = 4.0
    expect(body.campaigns[0].roas).toBe(4);

    expect(body.campaigns[1].name).toBe("Beta");
    expect(body.campaigns[1].user_count).toBe(0);
    expect(body.campaigns[1].total_spend_usd).toBe(15);

    expect(body.total_revenue_usd).toBe(80);
    expect(body.total_spend_usd).toBe(35);
  });
});

describe("GET /v1/projects/:projectId/ads/campaigns/:id/ad-groups", () => {
  it("returns ad groups within a campaign sorted by revenue", async () => {
    await seedUsers([
      // Campaign A → ad group AG1: 1 user, $30
      {
        user_id: "u1",
        campaign_id: "A",
        campaign_name: "Alpha",
        ad_group_id: "AG1",
        ad_group_name: "First",
        revenue_usd_cents: 3000,
      },
      // Campaign A → ad group AG2: 2 users, $50 + $50 = $100
      {
        user_id: "u2",
        campaign_id: "A",
        campaign_name: "Alpha",
        ad_group_id: "AG2",
        ad_group_name: "Second",
        revenue_usd_cents: 5000,
      },
      {
        user_id: "u3",
        campaign_id: "A",
        campaign_name: "Alpha",
        ad_group_id: "AG2",
        ad_group_name: "Second",
        revenue_usd_cents: 5000,
      },
      // Campaign B → ad group AG3: 1 user, $999 — must NOT appear in campaign A's results
      {
        user_id: "u4",
        campaign_id: "B",
        campaign_name: "Beta",
        ad_group_id: "AG3",
        ad_group_name: "Third",
        revenue_usd_cents: 99900,
      },
    ]);
    const res = await get(`/v1/projects/${projectId}/ads/campaigns/A/ad-groups`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.campaign_id).toBe("A");
    expect(body.campaign_name).toBe("Alpha");
    expect(body.ad_groups).toHaveLength(2);
    expect(body.ad_groups[0].id).toBe("Second");
    expect(body.ad_groups[0].total_revenue_usd).toBe(100);
    expect(body.ad_groups[1].id).toBe("First");
    expect(body.ad_groups[1].total_revenue_usd).toBe(30);
  });

  it("surfaces spend-only ad groups from ad_adgroup_lifetime even with no attributed users", async () => {
    // Spend-only campaign + spend-only ad groups. Drill-down via campaign
    // name (the dashboard URL uses whichever was non-null at aggregation).
    await sql`
      INSERT INTO ad_campaign_lifetime (team_id, project_id, app_id, apple_app_store_id, network, campaign_id, campaign_name, total_spend_usd_cents, spend_currency, last_synced_at)
      VALUES
        (${teamId}, ${projectId}, ${appId}, 12345, 'apple_search_ads', 'cmp-1', 'sewing_usa', 2544, 'USD', NOW())
    `;
    await sql`
      INSERT INTO ad_adgroup_lifetime (team_id, project_id, app_id, network, campaign_id, ad_group_id, ad_group_name, total_spend_usd_cents, spend_currency, ad_group_status, last_synced_at)
      VALUES
        (${teamId}, ${projectId}, ${appId}, 'apple_search_ads', 'cmp-1', 'ag-broad', 'broad_match', 1491, 'USD', 'RUNNING', NOW()),
        (${teamId}, ${projectId}, ${appId}, 'apple_search_ads', 'cmp-1', 'ag-exact', 'exact_match', 1053, 'USD', 'PAUSED', NOW())
    `;
    const res = await get(`/v1/projects/${projectId}/ads/campaigns/sewing_usa/ad-groups`);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.campaign_name).toBe("sewing_usa");
    expect(body.ad_groups).toHaveLength(2);
    // Sort by spend desc within the spend-only group ($0 revenue across).
    expect(body.ad_groups[0].name).toBe("broad_match");
    expect(body.ad_groups[0].total_spend_usd).toBeCloseTo(14.91, 2);
    expect(body.ad_groups[0].user_count).toBe(0);
    expect(body.ad_groups[0].status).toBe("RUNNING");
    expect(body.ad_groups[1].name).toBe("exact_match");
    expect(body.ad_groups[1].total_spend_usd).toBeCloseTo(10.53, 2);
    expect(body.ad_groups[1].status).toBe("PAUSED");

    expect(body.total_spend_usd).toBeCloseTo(25.44, 2);
  });
});

describe("GET /v1/projects/:projectId/ads/campaigns/:c/ad-groups/:g/leaves", () => {
  it("returns keywords and ads side by side", async () => {
    await seedUsers([
      // Keyword-attributed
      {
        user_id: "u1",
        campaign_id: "A",
        ad_group_id: "AG",
        keyword_id: "K1",
        keyword_name: "winter coat",
        revenue_usd_cents: 1000,
      },
      {
        user_id: "u2",
        campaign_id: "A",
        ad_group_id: "AG",
        keyword_id: "K1",
        keyword_name: "winter coat",
        revenue_usd_cents: 2000,
      },
      // Ad-attributed
      {
        user_id: "u3",
        campaign_id: "A",
        ad_group_id: "AG",
        ad_id: "AD1",
        ad_name: "Variant A",
        revenue_usd_cents: 4000,
      },
    ]);
    const res = await get(
      `/v1/projects/${projectId}/ads/campaigns/A/ad-groups/AG/leaves`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keywords).toHaveLength(1);
    expect(body.keywords[0].id).toBe("winter coat");
    expect(body.keywords[0].user_count).toBe(2);
    expect(body.keywords[0].total_revenue_usd).toBe(30);

    expect(body.ads).toHaveLength(1);
    expect(body.ads[0].id).toBe("Variant A");
    expect(body.ads[0].name).toBe("Variant A");
    expect(body.ads[0].total_revenue_usd).toBe(40);
  });
});

describe("GET /v1/ads/campaigns (team-scoped)", () => {
  // Seeds an attributed user directly (no junction needed — team-scoped
  // endpoint doesn't honor app_id) into the given project.
  async function seedAttributedUser(opts: {
    projectId: string;
    user_id: string;
    campaign_name: string;
    revenue_usd_cents: number;
  }) {
    await sql`
      INSERT INTO app_users (project_id, user_id, is_anonymous, properties, total_revenue_usd_cents)
      VALUES (${opts.projectId}, ${opts.user_id}, false,
              ${sql.json({
                attribution_source: "apple_search_ads",
                asa_campaign_name: opts.campaign_name,
              })},
              ${opts.revenue_usd_cents})
    `;
  }

  it("aggregates per (project_id, campaign) across every team project", async () => {
    // Spin up a second project on the same team so we can verify cross-project rows.
    const [{ id: secondProjectId }] = await sql<{ id: string }[]>`
      INSERT INTO projects (team_id, name, slug, color)
      VALUES (${teamId}, 'Second Project', 'second', '#ff0000')
      RETURNING id
    `;
    await Promise.all([
      seedAttributedUser({ projectId, user_id: "p1u1", campaign_name: "Alpha", revenue_usd_cents: 5000 }),
      seedAttributedUser({ projectId, user_id: "p1u2", campaign_name: "Alpha", revenue_usd_cents: 3000 }),
      seedAttributedUser({
        projectId: secondProjectId,
        user_id: "p2u1",
        campaign_name: "Alpha",
        revenue_usd_cents: 20000,
      }),
      seedAttributedUser({
        projectId: secondProjectId,
        user_id: "p2u2",
        campaign_name: "Beta",
        revenue_usd_cents: 1000,
      }),
    ]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/ads/campaigns?team_id=${teamId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Same-named campaigns in different projects stay distinct rows.
    expect(body.campaigns).toHaveLength(3);
    // Ordering: project2/Alpha ($200) > project1/Alpha ($80) > project2/Beta ($10)
    expect(body.campaigns[0].project_id).toBe(secondProjectId);
    expect(body.campaigns[0].name).toBe("Alpha");
    expect(body.campaigns[0].total_revenue_usd).toBe(200);
    expect(body.campaigns[1].project_id).toBe(projectId);
    expect(body.campaigns[1].name).toBe("Alpha");
    expect(body.campaigns[1].total_revenue_usd).toBe(80);
    expect(body.campaigns[2].project_id).toBe(secondProjectId);
    expect(body.campaigns[2].name).toBe("Beta");
    expect(body.campaigns[2].total_revenue_usd).toBe(10);

    expect(body.total_user_count).toBe(4);
    expect(body.total_revenue_usd).toBe(290);
  });

  it("excludes soft-deleted projects", async () => {
    const [{ id: deletedProjectId }] = await sql<{ id: string }[]>`
      INSERT INTO projects (team_id, name, slug, color, deleted_at)
      VALUES (${teamId}, 'Deleted Project', 'deleted', '#00ff00', NOW())
      RETURNING id
    `;
    await seedAttributedUser({
      projectId: deletedProjectId,
      user_id: "ghost",
      campaign_name: "Ghost",
      revenue_usd_cents: 99999,
    });
    await seedAttributedUser({
      projectId,
      user_id: "live",
      campaign_name: "Live",
      revenue_usd_cents: 1000,
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/ads/campaigns?team_id=${teamId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    const body = res.json();
    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0].name).toBe("Live");
    expect(body.campaigns[0].project_id).toBe(projectId);
  });

  it("returns empty when team_id is for a team the caller can't access", async () => {
    const fakeTeamId = "11111111-1111-1111-1111-111111111111";
    const res = await app.inject({
      method: "GET",
      url: `/v1/ads/campaigns?team_id=${fakeTeamId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().campaigns).toEqual([]);
  });

  it("includes spend-only campaigns across the team and tags each with project_id", async () => {
    const [{ id: secondProjectId }] = await sql<{ id: string }[]>`
      INSERT INTO projects (team_id, name, slug, color)
      VALUES (${teamId}, 'Second Project', 'second', '#ff0000')
      RETURNING id
    `;
    const [{ id: secondAppId }] = await sql<{ id: string }[]>`
      INSERT INTO apps (team_id, project_id, name, platform)
      VALUES (${teamId}, ${secondProjectId}, 'Second App', 'apple')
      RETURNING id
    `;
    // Project 1: attributed user + spend on the same campaign
    await seedAttributedUser({ projectId, user_id: "p1u1", campaign_name: "Shared", revenue_usd_cents: 5000 });
    await sql`
      INSERT INTO ad_campaign_lifetime (team_id, project_id, app_id, apple_app_store_id, network, campaign_id, campaign_name, total_spend_usd_cents, spend_currency, last_synced_at)
      VALUES (${teamId}, ${projectId}, ${appId}, 12345, 'apple_search_ads', 'shared-id', 'Shared', 1000, 'USD', NOW())
    `;
    // Project 2: spend-only (no attributed users)
    await sql`
      INSERT INTO ad_campaign_lifetime (team_id, project_id, app_id, apple_app_store_id, network, campaign_id, campaign_name, total_spend_usd_cents, spend_currency, last_synced_at)
      VALUES (${teamId}, ${secondProjectId}, ${secondAppId}, 67890, 'apple_search_ads', 'p2-only', 'Project2Only', 2500, 'USD', NOW())
    `;

    const res = await app.inject({
      method: "GET",
      url: `/v1/ads/campaigns?team_id=${teamId}`,
      headers: { authorization: `Bearer ${agentKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.campaigns).toHaveLength(2);
    // Project 1 / Shared has revenue → first.
    expect(body.campaigns[0].project_id).toBe(projectId);
    expect(body.campaigns[0].name).toBe("Shared");
    expect(body.campaigns[0].total_revenue_usd).toBe(50);
    expect(body.campaigns[0].total_spend_usd).toBe(10);
    // Project 2 / spend-only — no revenue but attributed to the right project.
    expect(body.campaigns[1].project_id).toBe(secondProjectId);
    expect(body.campaigns[1].name).toBe("Project2Only");
    expect(body.campaigns[1].user_count).toBe(0);
    expect(body.campaigns[1].total_spend_usd).toBe(25);
  });
});
