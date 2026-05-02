import type { AppleAdsAuthConfig, AppleAdsConfig } from "./config.js";
import { signAppleAdsClientAssertion } from "./jwt.js";

const TOKEN_ENDPOINT = "https://appleid.apple.com/auth/oauth2/token";
const CAMPAIGN_MANAGEMENT_BASE = "https://api.searchads.apple.com/api/v5";
const TOKEN_SAFETY_MARGIN_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Result wrapper for a single campaign-management lookup. `not_found` is
 * distinct from `error` so callers can cache the "this id is gone" negative
 * without retrying. `auth_error` surfaces misconfigured credentials cleanly to
 * the UI/integrations page.
 */
export type AppleAdsResult<T> =
  | { status: "found"; data: T }
  | { status: "not_found" }
  | { status: "auth_error"; message: string }
  | { status: "error"; statusCode: number; message: string };

export interface AppleAdsCampaign {
  id: number;
  name: string;
  status?: string;
  /** ISO datetime string `"YYYY-MM-DDTHH:mm:ss.sss"` (no zone). Null on `/reports/*` envelopes — only present when fetched via GET with the `startTime` field. */
  startTime?: string | null;
  endTime?: string | null;
  creationTime?: string | null;
}
export interface AppleAdsAdGroup {
  id: number;
  name: string;
  status?: string;
}
export interface AppleAdsTargetingKeyword {
  id: number;
  text: string;
  status?: string;
}
export interface AppleAdsAd {
  id: number;
  name: string;
  status?: string;
}
export interface AppleAdsAcl {
  orgId: number;
  orgName: string;
}

interface TokenBundle {
  accessToken: string;
  expiresAt: number;
}

// In-memory cache keyed by client_id. Apple Ads access tokens last 3600s;
// we re-mint on every process restart (no disk cache) and on hitting 401.
const tokenCache = new Map<string, TokenBundle>();

/** Exposed for tests — lets them clear the cache between runs. */
export function clearAppleAdsTokenCache(): void {
  tokenCache.clear();
}

async function mintAccessToken(
  config: AppleAdsAuthConfig,
): Promise<AppleAdsResult<TokenBundle>> {
  let clientAssertion: string;
  try {
    clientAssertion = signAppleAdsClientAssertion(config);
  } catch (err) {
    return {
      status: "auth_error",
      message: `Failed to sign client assertion — check the private key PEM. (${err instanceof Error ? err.message : "unknown error"})`,
    };
  }

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", config.client_id);
  form.set("client_secret", clientAssertion);
  form.set("scope", "searchadsorg");

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return networkError(err, "minting Apple Ads access token");
  }

  const bodyText = await response.text().catch(() => "");

  if (response.status === 400 || response.status === 401) {
    return {
      status: "auth_error",
      message: bodyText || `Apple rejected OAuth credentials (HTTP ${response.status})`,
    };
  }
  if (!response.ok) {
    return {
      status: "error",
      statusCode: response.status,
      message: bodyText || `upstream ${response.status}`,
    };
  }

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(bodyText) as { access_token?: string; expires_in?: number };
  } catch (err) {
    return {
      status: "error",
      statusCode: response.status,
      message: err instanceof Error ? err.message : "failed to decode Apple token response",
    };
  }

  if (!parsed.access_token) {
    return {
      status: "auth_error",
      message: "Apple token response missing access_token",
    };
  }

  const ttl = typeof parsed.expires_in === "number" && parsed.expires_in > 0 ? parsed.expires_in : 3600;
  const bundle: TokenBundle = {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + (ttl - TOKEN_SAFETY_MARGIN_SECONDS) * 1000,
  };
  tokenCache.set(config.client_id, bundle);
  return { status: "found", data: bundle };
}

async function getAccessToken(
  config: AppleAdsAuthConfig,
  opts: { forceRefresh?: boolean } = {},
): Promise<AppleAdsResult<TokenBundle>> {
  if (!opts.forceRefresh) {
    const cached = tokenCache.get(config.client_id);
    if (cached && cached.expiresAt > Date.now()) {
      return { status: "found", data: cached };
    }
  }
  return mintAccessToken(config);
}

async function appleAdsGet<T>(
  authConfig: AppleAdsAuthConfig,
  orgId: string | null,
  path: string,
): Promise<AppleAdsResult<T>> {
  const url = `${CAMPAIGN_MANAGEMENT_BASE}${path}`;

  const tokenResult = await getAccessToken(authConfig);
  if (tokenResult.status !== "found") return tokenResult;

  const doRequest = async (accessToken: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    if (orgId) {
      headers["X-AP-Context"] = `orgId=${orgId}`;
    }
    return fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };

  let response: Response;
  try {
    response = await doRequest(tokenResult.data.accessToken);
  } catch (err) {
    return networkError(err, "calling Apple Ads API");
  }

  // 401 → token may have been revoked server-side. Re-mint once, then retry.
  if (response.status === 401) {
    tokenCache.delete(authConfig.client_id);
    const refreshed = await getAccessToken(authConfig, { forceRefresh: true });
    if (refreshed.status !== "found") return refreshed;
    try {
      response = await doRequest(refreshed.data.accessToken);
    } catch (err) {
      return networkError(err, "on Apple Ads retry");
    }
    if (response.status === 401) {
      const body = await response.text().catch(() => "");
      return { status: "auth_error", message: body || "Apple rejected the access token twice" };
    }
  }

  if (response.status === 403) {
    const body = await response.text().catch(() => "");
    return { status: "auth_error", message: body || "Apple Ads returned 403 — check org_id scope and role" };
  }

  if (response.status === 404) {
    return { status: "not_found" };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { status: "error", statusCode: response.status, message: body || `upstream ${response.status}` };
  }

  let payload: { data?: T };
  try {
    payload = (await response.json()) as { data?: T };
  } catch (err) {
    return {
      status: "error",
      statusCode: response.status,
      message: err instanceof Error ? err.message : "failed to decode Apple Ads response",
    };
  }

  if (!payload.data) {
    return { status: "not_found" };
  }

  return { status: "found", data: payload.data };
}

function networkError(err: unknown, context: string): AppleAdsResult<never> {
  return {
    status: "error",
    statusCode: 0,
    message: err instanceof Error ? err.message : `network error ${context}`,
  };
}

/**
 * Resolve a campaign id → `{ id, name, status, startTime, endTime, creationTime }`.
 * The reports endpoint's row metadata omits `startTime`, so we ask for it here
 * — the metrics sync needs the campaign-start date for ROAS time-anchoring.
 * One round trip resolves both the human-readable name and the date span.
 */
export function getAppleAdsCampaign(
  config: AppleAdsConfig,
  campaignId: string | number,
): Promise<AppleAdsResult<AppleAdsCampaign>> {
  return appleAdsGet<AppleAdsCampaign>(
    config,
    config.org_id,
    `/campaigns/${encodeURIComponent(String(campaignId))}?fields=id,name,status,startTime,endTime,creationTime`,
  );
}

/** Resolve an ad group id → `{ id, name, status }`. */
export function getAppleAdsAdGroup(
  config: AppleAdsConfig,
  campaignId: string | number,
  adGroupId: string | number,
): Promise<AppleAdsResult<AppleAdsAdGroup>> {
  return appleAdsGet<AppleAdsAdGroup>(
    config,
    config.org_id,
    `/campaigns/${encodeURIComponent(String(campaignId))}/adgroups/${encodeURIComponent(String(adGroupId))}?fields=id,name,status`,
  );
}

/** Resolve a targeting keyword id → `{ id, text, status }`. */
export function getAppleAdsTargetingKeyword(
  config: AppleAdsConfig,
  campaignId: string | number,
  adGroupId: string | number,
  keywordId: string | number,
): Promise<AppleAdsResult<AppleAdsTargetingKeyword>> {
  return appleAdsGet<AppleAdsTargetingKeyword>(
    config,
    config.org_id,
    `/campaigns/${encodeURIComponent(String(campaignId))}/adgroups/${encodeURIComponent(String(adGroupId))}/targetingkeywords/${encodeURIComponent(String(keywordId))}?fields=id,text,status`,
  );
}

/** Resolve an ad id → `{ id, name, status }`. */
export function getAppleAdsAd(
  config: AppleAdsConfig,
  campaignId: string | number,
  adGroupId: string | number,
  adId: string | number,
): Promise<AppleAdsResult<AppleAdsAd>> {
  return appleAdsGet<AppleAdsAd>(
    config,
    config.org_id,
    `/campaigns/${encodeURIComponent(String(campaignId))}/adgroups/${encodeURIComponent(String(adGroupId))}/ads/${encodeURIComponent(String(adId))}?fields=id,name,status`,
  );
}

/**
 * List the orgs (campaign groups) the credentials can access. Used by the
 * "Test connection" flow on the integrations page to validate credentials
 * and help customers pick the right org_id. `/acls` is scoped by credentials
 * only — no `X-AP-Context` header.
 */
export function getAppleAdsAcls(
  config: AppleAdsAuthConfig,
): Promise<AppleAdsResult<AppleAdsAcl[]>> {
  return appleAdsGet<AppleAdsAcl[]>(config, null, "/acls");
}

// --- Reports API ----------------------------------------------------------
//
// `/reports/*` is shaped differently from `/campaigns/*`: the response is
// `{ data: { reportingDataResponse: { row: [...] } }, pagination, error }`,
// every metric is wrapped in a `{ amount: "<decimal>", currency: "USD" }`
// envelope, and it's billed against a per-org rate limit. Each request can
// span at most ~90 days, so callers chunk the window themselves and sum
// across results — the helpers here are deliberately thin so the metrics
// sync owns the chunking + summation logic.

/** Per-currency monetary value as Apple returns it on report rows. */
export interface AppleAdsMoney {
  /** Decimal string with up to 4 fractional digits, e.g. `"14.8051"`. */
  amount: string;
  /** ISO 4217 code, e.g. `"USD"`. */
  currency: string;
}

/** `metadata.app` on every campaign-level report row. */
export interface AppleAdsReportApp {
  appName: string;
  /** Apple's numeric App Store ID for the app the campaign promotes. */
  adamId: number;
}

/** Campaign-level metadata block — omits start/end times (use `getAppleAdsCampaign`). */
export interface AppleAdsCampaignReportMetadata {
  campaignId: number;
  orgId: number;
  campaignName: string;
  campaignStatus: string;
  displayStatus?: string;
  servingStatus?: string;
  servingStateReasons?: string[] | null;
  app: AppleAdsReportApp;
  countriesOrRegions?: string[];
  dailyBudget?: AppleAdsMoney | null;
  totalBudget?: AppleAdsMoney | null;
  adChannelType?: string;
  billingEvent?: string;
  biddingStrategy?: string;
  modificationTime?: string;
  deleted?: boolean;
}

/** Ad-group-level metadata block — these rows DO carry start/end times natively. */
export interface AppleAdsAdGroupReportMetadata {
  adGroupId: number;
  campaignId: number;
  orgId: number;
  adGroupName: string;
  adGroupStatus?: string;
  adGroupServingStatus?: string;
  adGroupServingStateReasons?: string[] | null;
  startTime?: string | null;
  endTime?: string | null;
  modificationTime?: string;
  deleted?: boolean;
}

/** Common shape of `total` (and each `granularity[]` entry) on report rows. */
export interface AppleAdsReportTotals {
  localSpend: AppleAdsMoney;
  impressions: number;
  taps: number;
  totalInstalls: number;
  totalNewDownloads?: number;
  totalRedownloads?: number;
  tapInstalls?: number;
  viewInstalls?: number;
  ttr?: number;
  totalInstallRate?: number;
}

/** A single row inside `data.reportingDataResponse.row[]`. */
export interface AppleAdsReportRow<TMetadata> {
  metadata: TMetadata;
  granularity?: Array<AppleAdsReportTotals & { date: string }>;
  total?: AppleAdsReportTotals;
  other: boolean;
}

/** Response envelope returned by every `/reports/*` POST. */
export interface AppleAdsReportResponse<TMetadata> {
  reportingDataResponse: {
    row: AppleAdsReportRow<TMetadata>[];
    grandTotals?: AppleAdsReportTotals;
  };
}

export interface AppleAdsReportRequest {
  /** ISO date `YYYY-MM-DD`. Inclusive. */
  startTime: string;
  /** ISO date `YYYY-MM-DD`. Inclusive. */
  endTime: string;
  /** Defaults to `"DAILY"` — caller can also pass `"HOURLY" | "WEEKLY" | "MONTHLY"`. */
  granularity?: "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY";
  /** Number of rows to return (max 1000 per Apple's docs). Defaults to 1000. */
  limit?: number;
  /** Pagination offset. Defaults to 0. */
  offset?: number;
  /** Status values to include. Defaults to ENABLED + PAUSED + ON_HOLD. */
  statuses?: string[];
}

function buildReportBody(req: AppleAdsReportRequest, orderByField: string) {
  return {
    startTime: req.startTime,
    endTime: req.endTime,
    granularity: req.granularity ?? "DAILY",
    groupBy: [],
    selector: {
      orderBy: [{ field: orderByField, sortOrder: "ASCENDING" }],
      pagination: { offset: req.offset ?? 0, limit: req.limit ?? 1000 },
      conditions: [
        {
          field: orderByField === "campaignId" ? "campaignStatus" : "adGroupStatus",
          operator: "IN",
          values: req.statuses ?? ["ENABLED", "PAUSED", "ON_HOLD"],
        },
      ],
    },
    returnRecordsWithNoMetrics: true,
    returnRowTotals: true,
  };
}

/**
 * Generic POST helper. Mirrors `appleAdsGet` (same auth, 401 retry-once,
 * 403/404 mapping) but accepts a JSON body. Reports endpoints return data
 * wrapped in `{ data: { reportingDataResponse: { row: [...] } } }` rather
 * than `{ data: [...] }`; callers receive whatever shape `T` claims to be.
 */
async function appleAdsPost<T>(
  authConfig: AppleAdsAuthConfig,
  orgId: string | null,
  path: string,
  body: unknown,
): Promise<AppleAdsResult<T>> {
  const url = `${CAMPAIGN_MANAGEMENT_BASE}${path}`;
  const tokenResult = await getAccessToken(authConfig);
  if (tokenResult.status !== "found") return tokenResult;

  const doRequest = async (accessToken: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (orgId) {
      headers["X-AP-Context"] = `orgId=${orgId}`;
    }
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };

  let response: Response;
  try {
    response = await doRequest(tokenResult.data.accessToken);
  } catch (err) {
    return networkError(err, "calling Apple Ads Reports API");
  }

  if (response.status === 401) {
    tokenCache.delete(authConfig.client_id);
    const refreshed = await getAccessToken(authConfig, { forceRefresh: true });
    if (refreshed.status !== "found") return refreshed;
    try {
      response = await doRequest(refreshed.data.accessToken);
    } catch (err) {
      return networkError(err, "on Apple Ads Reports retry");
    }
    if (response.status === 401) {
      const body2 = await response.text().catch(() => "");
      return { status: "auth_error", message: body2 || "Apple rejected the access token twice" };
    }
  }

  if (response.status === 403) {
    const body2 = await response.text().catch(() => "");
    return { status: "auth_error", message: body2 || "Apple Ads returned 403 — check org_id scope and role" };
  }

  if (response.status === 404) {
    return { status: "not_found" };
  }

  if (!response.ok) {
    const body2 = await response.text().catch(() => "");
    return { status: "error", statusCode: response.status, message: body2 || `upstream ${response.status}` };
  }

  let payload: { data?: T };
  try {
    payload = (await response.json()) as { data?: T };
  } catch (err) {
    return {
      status: "error",
      statusCode: response.status,
      message: err instanceof Error ? err.message : "failed to decode Apple Ads Reports response",
    };
  }

  if (!payload.data) {
    return { status: "not_found" };
  }
  return { status: "found", data: payload.data };
}

/**
 * Fetch a campaign-level report covering `startTime`..`endTime`. Apple caps
 * single requests at ~90 days, so callers loop themselves; the report's
 * `total` block is the rolled-up window summary that we sum across chunks.
 */
export function postAppleAdsCampaignReport(
  config: AppleAdsConfig,
  req: AppleAdsReportRequest,
): Promise<AppleAdsResult<AppleAdsReportResponse<AppleAdsCampaignReportMetadata>>> {
  return appleAdsPost<AppleAdsReportResponse<AppleAdsCampaignReportMetadata>>(
    config,
    config.org_id,
    "/reports/campaigns",
    buildReportBody(req, "campaignId"),
  );
}

/** Fetch an ad-group-level report scoped to a single campaign. */
export function postAppleAdsAdGroupReport(
  config: AppleAdsConfig,
  campaignId: string | number,
  req: AppleAdsReportRequest,
): Promise<AppleAdsResult<AppleAdsReportResponse<AppleAdsAdGroupReportMetadata>>> {
  return appleAdsPost<AppleAdsReportResponse<AppleAdsAdGroupReportMetadata>>(
    config,
    config.org_id,
    `/reports/campaigns/${encodeURIComponent(String(campaignId))}/adgroups`,
    buildReportBody(req, "adGroupId"),
  );
}
