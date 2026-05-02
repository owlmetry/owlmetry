/**
 * One-off probe for Apple Search Ads Reports API.
 *
 * Usage:
 *   tsx apps/server/src/scripts/probe-apple-ads-reports.ts            # list candidates
 *   tsx apps/server/src/scripts/probe-apple-ads-reports.ts <projectId>
 *
 * Mints an access token using the project's stored Apple Search Ads
 * integration, then POSTs to /reports/campaigns and /reports/campaigns/{id}/adgroups
 * with a 7-day window. Prints raw JSON so we can confirm field names + currency
 * + date formats before building the real sync. Read-only — does not write to
 * the DB.
 */
import { config } from "../config.js";
import { createDatabaseConnection } from "@owlmetry/db";
import { sql } from "drizzle-orm";
import { signAppleAdsClientAssertion } from "../utils/apple-ads/jwt.js";
import type { AppleAdsConfig } from "../utils/apple-ads/config.js";

const TOKEN_ENDPOINT = "https://appleid.apple.com/auth/oauth2/token";
const REPORTS_BASE = "https://api.searchads.apple.com/api/v5";
const REQUEST_TIMEOUT_MS = 15_000;

const projectIdArg = process.argv[2];
const db = createDatabaseConnection(config.databaseUrl);

async function listCandidates(): Promise<void> {
  const rows = await db.execute<{
    project_id: string;
    project_name: string;
    org_id: string | null;
    client_id: string | null;
    enabled: boolean;
  }>(sql`
    SELECT
      pi.project_id::text AS project_id,
      p.name AS project_name,
      pi.config->>'org_id' AS org_id,
      pi.config->>'client_id' AS client_id,
      pi.enabled
    FROM project_integrations pi
    JOIN projects p ON p.id = pi.project_id
    WHERE pi.provider = 'apple-search-ads'
      AND pi.deleted_at IS NULL
      AND p.deleted_at IS NULL
    ORDER BY pi.enabled DESC, p.name ASC
  `);

  if (rows.length === 0) {
    console.log("No Apple Search Ads integrations found in this database.");
    return;
  }

  console.log("Active Apple Search Ads integrations:\n");
  for (const row of rows) {
    const status = row.enabled ? "enabled" : "disabled";
    const orgPart = row.org_id ? `org_id=${row.org_id}` : "no org_id";
    const clientPart = row.client_id ? `client_id=${row.client_id.slice(0, 12)}…` : "no client_id";
    console.log(`  ${status.padEnd(9)} ${row.project_id}  ${row.project_name}`);
    console.log(`            ${orgPart}, ${clientPart}\n`);
  }
  console.log(`Run again with a project_id to probe:`);
  console.log(`  tsx apps/server/src/scripts/probe-apple-ads-reports.ts <projectId>`);
}

interface MintedToken {
  accessToken: string;
  expiresIn: number;
}

async function mintToken(adsConfig: AppleAdsConfig): Promise<MintedToken> {
  const clientAssertion = signAppleAdsClientAssertion(adsConfig);
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", adsConfig.client_id);
  form.set("client_secret", clientAssertion);
  form.set("scope", "searchadsorg");

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Apple token endpoint returned ${response.status}: ${bodyText}`);
  }

  const parsed = JSON.parse(bodyText) as { access_token?: string; expires_in?: number };
  if (!parsed.access_token) {
    throw new Error(`Apple token response missing access_token: ${bodyText}`);
  }
  return {
    accessToken: parsed.access_token,
    expiresIn: parsed.expires_in ?? 3600,
  };
}

async function postReport<T = unknown>(
  accessToken: string,
  orgId: string,
  path: string,
  body: unknown,
): Promise<{ status: number; payload: T | string }> {
  const response = await fetch(`${REPORTS_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-AP-Context": `orgId=${orgId}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text().catch(() => "");
  let payload: T | string;
  try {
    payload = JSON.parse(text) as T;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function probe(projectId: string): Promise<void> {
  const [integration] = await db.execute<{
    config: AppleAdsConfig;
    enabled: boolean;
  }>(sql`
    SELECT config, enabled
    FROM project_integrations
    WHERE project_id = ${projectId}
      AND provider = 'apple-search-ads'
      AND deleted_at IS NULL
    LIMIT 1
  `);

  if (!integration) {
    console.error(`No Apple Search Ads integration found for project ${projectId}.`);
    process.exit(1);
  }
  if (!integration.enabled) {
    console.error(`Integration exists but is disabled. Aborting.`);
    process.exit(1);
  }

  const adsConfig = integration.config;
  const required: (keyof AppleAdsConfig)[] = ["client_id", "team_id", "key_id", "private_key_pem", "org_id"];
  for (const field of required) {
    if (!adsConfig[field]) {
      console.error(`Integration missing required field: ${field}`);
      process.exit(1);
    }
  }

  console.log(`\n=== Project ${projectId} ===`);
  console.log(`org_id:    ${adsConfig.org_id}`);
  console.log(`client_id: ${adsConfig.client_id.slice(0, 16)}…`);
  console.log(`team_id:   ${adsConfig.team_id}`);
  console.log(`key_id:    ${adsConfig.key_id}\n`);

  console.log("--- Step 1: mint access token ---");
  const token = await mintToken(adsConfig);
  console.log(`OK. expires_in=${token.expiresIn}s, token=${token.accessToken.slice(0, 12)}…\n`);

  // ASA caps each report at ~90 days. We walk backwards in 4× 90-day chunks
  // to cover ~12 months — same window Apple's dashboard uses by default.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const chunks: { startTime: string; endTime: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const end = new Date(today);
    end.setUTCDate(today.getUTCDate() - i * 90 - (i === 0 ? 0 : 1));
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 89);
    chunks.push({ startTime: formatDate(start), endTime: formatDate(end) });
  }
  console.log(`--- Step 2: POST /reports/campaigns × ${chunks.length} chunks (12 months) ---`);
  for (const c of chunks) console.log(`  chunk: ${c.startTime} → ${c.endTime}`);

  // Aggregate per-campaign across all chunks. Limit per chunk is high enough
  // to capture every campaign in the org (probe target had 10 total).
  const sumByCampaign = new Map<number, {
    campaignId: number;
    campaignName: string;
    campaignStatus: string;
    appName: string;
    adamId: number;
    countriesOrRegions: string[];
    spend: number;
    impressions: number;
    taps: number;
    totalInstalls: number;
    currency: string;
  }>();

  for (const chunk of chunks) {
    const body = {
      startTime: chunk.startTime,
      endTime: chunk.endTime,
      granularity: "DAILY",
      groupBy: [],
      selector: {
        orderBy: [{ field: "campaignId", sortOrder: "ASCENDING" }],
        pagination: { offset: 0, limit: 1000 },
        conditions: [
          {
            field: "campaignStatus",
            operator: "IN",
            values: ["ENABLED", "PAUSED", "ON_HOLD"],
          },
        ],
      },
      returnRecordsWithNoMetrics: true,
      returnRowTotals: true,
    };
    const result = await postReport<unknown>(
      token.accessToken,
      adsConfig.org_id,
      "/reports/campaigns",
      body,
    );
    if (result.status !== 200) {
      console.log(`\n  chunk ${chunk.startTime}→${chunk.endTime} failed: HTTP ${result.status}`);
      console.log(JSON.stringify(result.payload, null, 2));
      continue;
    }
    const payload = result.payload as Record<string, unknown>;
    const data = payload.data as Record<string, unknown> | undefined;
    const inner = data?.reportingDataResponse as Record<string, unknown> | undefined;
    const rows = inner?.row as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      const meta = row.metadata as Record<string, unknown>;
      const total = row.total as Record<string, unknown> | undefined;
      const localSpend = total?.localSpend as { amount?: string; currency?: string } | undefined;
      const app = meta.app as { appName?: string; adamId?: number } | undefined;
      const cid = meta.campaignId as number;
      const prior = sumByCampaign.get(cid);
      const spendDelta = Number(localSpend?.amount ?? 0);
      sumByCampaign.set(cid, {
        campaignId: cid,
        campaignName: meta.campaignName as string,
        campaignStatus: meta.campaignStatus as string,
        appName: app?.appName ?? "",
        adamId: app?.adamId ?? 0,
        countriesOrRegions: (meta.countriesOrRegions as string[]) ?? [],
        spend: (prior?.spend ?? 0) + spendDelta,
        impressions: (prior?.impressions ?? 0) + ((total?.impressions as number) ?? 0),
        taps: (prior?.taps ?? 0) + ((total?.taps as number) ?? 0),
        totalInstalls: (prior?.totalInstalls ?? 0) + ((total?.totalInstalls as number) ?? 0),
        currency: localSpend?.currency ?? "",
      });
    }
  }

  console.log(`\n--- Aggregated 12-month totals (${sumByCampaign.size} campaigns) ---`);
  const sorted = Array.from(sumByCampaign.values()).sort((a, b) => b.spend - a.spend);
  for (const c of sorted) {
    console.log(
      `  $${c.spend.toFixed(2).padStart(10)} | ${c.campaignStatus.padEnd(8)} | ${c.appName.padEnd(35)} | ${c.campaignName} (${c.adamId})`,
    );
  }

  // Drill into the top campaign for ad-group validation.
  const top = sorted[0];
  if (!top) return;

  console.log(`\n--- Step 3: ad-group report for top campaign "${top.campaignName}" ---`);
  const adGroupBody = {
    startTime: chunks[0].startTime,
    endTime: chunks[0].endTime,
    granularity: "DAILY",
    groupBy: [],
    selector: {
      orderBy: [{ field: "adGroupId", sortOrder: "ASCENDING" }],
      pagination: { offset: 0, limit: 100 },
    },
    returnRecordsWithNoMetrics: true,
    returnRowTotals: true,
  };
  const adGroupResult = await postReport<unknown>(
    token.accessToken,
    adsConfig.org_id,
    `/reports/campaigns/${top.campaignId}/adgroups`,
    adGroupBody,
  );
  console.log(`HTTP ${adGroupResult.status}`);
  if (adGroupResult.status === 200) {
    const payload = adGroupResult.payload as Record<string, unknown>;
    const data = payload.data as Record<string, unknown> | undefined;
    const inner = data?.reportingDataResponse as Record<string, unknown> | undefined;
    const rows = (inner?.row as Array<Record<string, unknown>>) ?? [];
    console.log(`  ${rows.length} ad-groups returned in 90-day window:`);
    for (const r of rows) {
      const meta = r.metadata as Record<string, unknown>;
      const total = r.total as Record<string, unknown> | undefined;
      const localSpend = total?.localSpend as { amount?: string; currency?: string } | undefined;
      console.log(
        `    adGroupId=${meta.adGroupId} name="${meta.adGroupName}" startTime=${meta.startTime} status=${meta.adGroupStatus ?? meta.adGroupServingStatus ?? "?"} spend=$${Number(localSpend?.amount ?? 0).toFixed(2)}`,
      );
    }
  } else {
    console.log(JSON.stringify(adGroupResult.payload, null, 2));
  }

  // Confirm extended GET fields work for startTime/endTime/creationTime.
  console.log(`\n--- Step 4: GET /campaigns/${top.campaignId}?fields=id,name,status,startTime,endTime,creationTime ---`);
  const campaignGetResponse = await fetch(
    `${REPORTS_BASE}/campaigns/${top.campaignId}?fields=id,name,status,startTime,endTime,creationTime`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        Accept: "application/json",
        "X-AP-Context": `orgId=${adsConfig.org_id}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const campaignGetText = await campaignGetResponse.text().catch(() => "");
  let campaignGetPayload: unknown;
  try {
    campaignGetPayload = JSON.parse(campaignGetText);
  } catch {
    campaignGetPayload = campaignGetText;
  }
  console.log(`HTTP ${campaignGetResponse.status}`);
  console.log(JSON.stringify(campaignGetPayload, null, 2));
}

try {
  if (!projectIdArg) {
    await listCandidates();
  } else {
    await probe(projectIdArg);
  }
} finally {
  // pg-pool keeps the process alive otherwise.
  process.exit(0);
}
