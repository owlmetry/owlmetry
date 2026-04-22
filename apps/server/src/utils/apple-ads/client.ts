import type { AppleAdsConfig } from "./config.js";
import { signAppleAdsClientAssertion } from "./jwt.js";

const TOKEN_ENDPOINT = "https://appleid.apple.com/auth/oauth2/token";
const CAMPAIGN_MANAGEMENT_BASE = "https://api.searchads.apple.com/api/v5";
const TOKEN_SAFETY_MARGIN_SECONDS = 60;

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
  currency?: string;
  roleNames?: string[];
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
  config: AppleAdsConfig,
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
    });
  } catch (err) {
    return {
      status: "error",
      statusCode: 0,
      message: err instanceof Error ? err.message : "network error minting Apple Ads access token",
    };
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
  config: AppleAdsConfig,
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
  config: AppleAdsConfig,
  path: string,
  opts: { includeOrgContext?: boolean } = {},
): Promise<AppleAdsResult<T>> {
  const url = `${CAMPAIGN_MANAGEMENT_BASE}${path}`;
  const includeOrgContext = opts.includeOrgContext !== false;

  const tokenResult = await getAccessToken(config);
  if (tokenResult.status !== "found") return tokenResult;

  const doRequest = async (accessToken: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    if (includeOrgContext) {
      headers["X-AP-Context"] = `orgId=${config.org_id}`;
    }
    return fetch(url, { method: "GET", headers });
  };

  let response: Response;
  try {
    response = await doRequest(tokenResult.data.accessToken);
  } catch (err) {
    return {
      status: "error",
      statusCode: 0,
      message: err instanceof Error ? err.message : "network error calling Apple Ads API",
    };
  }

  // 401 → token may have been revoked server-side. Re-mint once, then retry.
  if (response.status === 401) {
    tokenCache.delete(config.client_id);
    const refreshed = await getAccessToken(config, { forceRefresh: true });
    if (refreshed.status !== "found") return refreshed;
    try {
      response = await doRequest(refreshed.data.accessToken);
    } catch (err) {
      return {
        status: "error",
        statusCode: 0,
        message: err instanceof Error ? err.message : "network error on Apple Ads retry",
      };
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

/** Resolve a campaign id → `{ id, name, status }`. */
export function getAppleAdsCampaign(
  config: AppleAdsConfig,
  campaignId: string | number,
): Promise<AppleAdsResult<AppleAdsCampaign>> {
  return appleAdsGet<AppleAdsCampaign>(
    config,
    `/campaigns/${encodeURIComponent(String(campaignId))}?fields=id,name,status`,
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
    `/campaigns/${encodeURIComponent(String(campaignId))}/adgroups/${encodeURIComponent(String(adGroupId))}/ads/${encodeURIComponent(String(adId))}?fields=id,name,status`,
  );
}

/**
 * List the orgs (campaign groups) the credentials can access. Used by the
 * "Test connection" flow on the integrations page to validate credentials and
 * help customers pick the right org_id. Unlike the other endpoints, /acls is
 * scoped by credentials only — we skip the X-AP-Context header.
 */
export function getAppleAdsAcls(
  config: Omit<AppleAdsConfig, "org_id">,
): Promise<AppleAdsResult<AppleAdsAcl[]>> {
  const tempConfig: AppleAdsConfig = { ...config, org_id: "" };
  return appleAdsGet<AppleAdsAcl[]>(tempConfig, "/acls", { includeOrgContext: false });
}
