import type { AppStoreConnectConfig } from "./config.js";
import { signAppStoreConnectJwt } from "./jwt.js";

const ASC_BASE = "https://api.appstoreconnect.apple.com";
const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_TTL_SECONDS = 1140;
const TOKEN_SAFETY_MARGIN_SECONDS = 60;

/** Result wrapper mirroring the AppleAdsResult shape. */
export type AppStoreConnectResult<T> =
  | { status: "found"; data: T }
  | { status: "not_found" }
  | { status: "auth_error"; message: string }
  | { status: "error"; statusCode: number; message: string };

interface TokenBundle {
  jwt: string;
  expiresAt: number;
}

// In-memory cache keyed by `${issuer_id}:${key_id}` — JWTs ARE the bearer
// token for ASC (unlike Apple Ads which exchanges a JWT for a separate access
// token), so the JWT sits directly in the Authorization header until expiry.
const tokenCache = new Map<string, TokenBundle>();

export function clearAppStoreConnectTokenCache(): void {
  tokenCache.clear();
}

function cacheKey(config: Pick<AppStoreConnectConfig, "issuer_id" | "key_id">): string {
  return `${config.issuer_id}:${config.key_id}`;
}

function networkError<T>(err: unknown, context: string): AppStoreConnectResult<T> {
  const message = err instanceof Error ? err.message : String(err);
  return { status: "error", statusCode: 0, message: `network error ${context}: ${message}` };
}

function mintToken(config: AppStoreConnectConfig): AppStoreConnectResult<TokenBundle> {
  try {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + TOKEN_TTL_SECONDS;
    const jwt = signAppStoreConnectJwt(config, { iat, exp });
    const bundle: TokenBundle = {
      jwt,
      expiresAt: Date.now() + (TOKEN_TTL_SECONDS - TOKEN_SAFETY_MARGIN_SECONDS) * 1000,
    };
    tokenCache.set(cacheKey(config), bundle);
    return { status: "found", data: bundle };
  } catch (err) {
    return {
      status: "auth_error",
      message: `Failed to sign App Store Connect JWT — check the .p8 contents (${err instanceof Error ? err.message : "unknown error"})`,
    };
  }
}

function getToken(
  config: AppStoreConnectConfig,
  opts: { forceRefresh?: boolean } = {},
): AppStoreConnectResult<TokenBundle> {
  if (!opts.forceRefresh) {
    const cached = tokenCache.get(cacheKey(config));
    if (cached && cached.expiresAt > Date.now()) {
      return { status: "found", data: cached };
    }
  }
  return mintToken(config);
}

async function ascGet<T>(config: AppStoreConnectConfig, url: string): Promise<AppStoreConnectResult<T>> {
  const tokenResult = getToken(config);
  if (tokenResult.status !== "found") return tokenResult;

  const doRequest = async (jwt: string) =>
    fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let response: Response;
  try {
    response = await doRequest(tokenResult.data.jwt);
  } catch (err) {
    return networkError(err, "calling App Store Connect API");
  }

  // 401 → JWT may have been server-side revoked or clock-skewed. Re-mint once.
  if (response.status === 401) {
    tokenCache.delete(cacheKey(config));
    const refreshed = getToken(config, { forceRefresh: true });
    if (refreshed.status !== "found") return refreshed;
    try {
      response = await doRequest(refreshed.data.jwt);
    } catch (err) {
      return networkError(err, "on App Store Connect retry");
    }
    if (response.status === 401) {
      const body = await response.text().catch(() => "");
      return { status: "auth_error", message: body || "Apple rejected the JWT twice" };
    }
  }

  if (response.status === 403) {
    const body = await response.text().catch(() => "");
    return { status: "auth_error", message: body || "App Store Connect returned 403 — check the key role (needs Customer Support or higher for read-only access)" };
  }

  if (response.status === 404) {
    return { status: "not_found" };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { status: "error", statusCode: response.status, message: body || `upstream ${response.status}` };
  }

  let payload: T;
  try {
    payload = (await response.json()) as T;
  } catch (err) {
    return {
      status: "error",
      statusCode: response.status,
      message: err instanceof Error ? err.message : "failed to decode App Store Connect response",
    };
  }
  return { status: "found", data: payload };
}

// =====================================================================
// Apps endpoint — used by the discover-apps route + connection test.
// =====================================================================

export interface AppStoreConnectApp {
  id: string;
  name: string;
  bundleId: string;
}

interface AscAppsPayload {
  data: Array<{
    id: string;
    attributes: { name?: string; bundleId?: string };
  }>;
}

export async function listAppStoreConnectApps(
  config: AppStoreConnectConfig,
): Promise<AppStoreConnectResult<AppStoreConnectApp[]>> {
  const url = `${ASC_BASE}/v1/apps?fields[apps]=name,bundleId&limit=200`;
  const result = await ascGet<AscAppsPayload>(config, url);
  if (result.status !== "found") return result;
  const apps: AppStoreConnectApp[] = (result.data.data ?? []).map((row) => ({
    id: row.id,
    name: row.attributes?.name ?? "",
    bundleId: row.attributes?.bundleId ?? "",
  }));
  return { status: "found", data: apps };
}

// =====================================================================
// Customer reviews endpoint — paginated, newest-first, with optional
// developer response include.
// =====================================================================

export interface AppStoreConnectReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  reviewer_nickname: string | null;
  /** ISO 3166-1 alpha-3 territory code, e.g. "USA". */
  territory: string | null;
  created_at: Date;
  developer_response: string | null;
  developer_response_at: Date | null;
}

interface AscReviewRow {
  id: string;
  attributes?: {
    rating?: number;
    title?: string | null;
    body?: string;
    reviewerNickname?: string | null;
    createdDate?: string;
    territory?: string | null;
  };
  relationships?: {
    response?: { data?: { id?: string } | null };
  };
}

interface AscResponseRow {
  id: string;
  type: string;
  attributes?: {
    responseBody?: string;
    lastModifiedDate?: string;
  };
}

interface AscReviewsPayload {
  data: AscReviewRow[];
  included?: AscResponseRow[];
  links?: { next?: string };
}

export interface AppStoreConnectReviewsPage {
  reviews: AppStoreConnectReview[];
  nextCursor: string | null;
}

function buildReviewsFirstUrl(appleAppStoreId: number): string {
  const params = new URLSearchParams({
    sort: "-createdDate",
    limit: "200",
    include: "response",
    "fields[customerReviews]": "rating,title,body,reviewerNickname,createdDate,territory",
    "fields[customerReviewResponses]": "responseBody,lastModifiedDate",
  });
  return `${ASC_BASE}/v1/apps/${appleAppStoreId}/customerReviews?${params.toString()}`;
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function listAppStoreConnectReviews(
  config: AppStoreConnectConfig,
  appleAppStoreId: number,
  opts: { cursorUrl?: string } = {},
): Promise<AppStoreConnectResult<AppStoreConnectReviewsPage>> {
  const url = opts.cursorUrl ?? buildReviewsFirstUrl(appleAppStoreId);
  const result = await ascGet<AscReviewsPayload>(config, url);
  if (result.status !== "found") return result;

  // Build a map of response-row-id → developer response so we can attach by
  // relationships.response.data.id without an O(n²) scan per review.
  const responsesById = new Map<string, AscResponseRow>();
  for (const row of result.data.included ?? []) {
    if (row.type === "customerReviewResponses") {
      responsesById.set(row.id, row);
    }
  }

  const reviews: AppStoreConnectReview[] = [];
  for (const row of result.data.data ?? []) {
    const ratingRaw = row.attributes?.rating;
    const body = row.attributes?.body;
    const created = parseDate(row.attributes?.createdDate);
    if (typeof ratingRaw !== "number" || !body || !created) continue;
    const rating = Math.max(1, Math.min(5, Math.round(ratingRaw)));
    const responseId = row.relationships?.response?.data?.id;
    const responseRow = responseId ? responsesById.get(responseId) : undefined;
    reviews.push({
      id: row.id,
      rating,
      title: row.attributes?.title ?? null,
      body,
      reviewer_nickname: row.attributes?.reviewerNickname ?? null,
      territory: row.attributes?.territory ?? null,
      created_at: created,
      developer_response: responseRow?.attributes?.responseBody ?? null,
      developer_response_at: parseDate(responseRow?.attributes?.lastModifiedDate),
    });
  }

  return {
    status: "found",
    data: {
      reviews,
      nextCursor: result.data.links?.next ?? null,
    },
  };
}
