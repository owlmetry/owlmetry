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
  | { status: "rate_limited"; retryAfterSeconds: number; message: string }
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

type AscMethod = "GET" | "POST" | "DELETE";

interface AscSendOptions {
  /** Treat a 200 with no body (or 204) as success. The caller doesn't need a payload. */
  expectNoBody?: boolean;
}

async function ascSend<T>(
  config: AppStoreConnectConfig,
  method: AscMethod,
  url: string,
  body?: unknown,
  opts: AscSendOptions = {},
): Promise<AppStoreConnectResult<T>> {
  const tokenResult = getToken(config);
  if (tokenResult.status !== "found") return tokenResult;

  const doRequest = async (jwt: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    };
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(url, init);
  };

  let response: Response;
  try {
    response = await doRequest(tokenResult.data.jwt);
  } catch (err) {
    return networkError(err, "calling App Store Connect API");
  }

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
      const respBody = await response.text().catch(() => "");
      return { status: "auth_error", message: respBody || "Apple rejected the JWT twice" };
    }
  }

  if (response.status === 403) {
    const respBody = await response.text().catch(() => "");
    return {
      status: "auth_error",
      message:
        respBody ||
        "App Store Connect returned 403 — the API key needs Customer Support role or higher (covers reading reviews and managing review responses)",
    };
  }

  if (response.status === 404) {
    return { status: "not_found" };
  }

  if (response.status === 429) {
    const headerValue = response.headers.get("retry-after");
    const parsed = headerValue ? Number.parseInt(headerValue, 10) : NaN;
    const retryAfterSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
    const respBody = await response.text().catch(() => "");
    return {
      status: "rate_limited",
      retryAfterSeconds,
      message: respBody || `App Store Connect rate-limited (retry after ${retryAfterSeconds}s)`,
    };
  }

  if (!response.ok) {
    const respBody = await response.text().catch(() => "");
    return { status: "error", statusCode: response.status, message: respBody || `upstream ${response.status}` };
  }

  if (opts.expectNoBody || response.status === 204) {
    return { status: "found", data: undefined as T };
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

async function ascGet<T>(config: AppStoreConnectConfig, url: string): Promise<AppStoreConnectResult<T>> {
  return ascSend<T>(config, "GET", url);
}

// =====================================================================
// Apps endpoint — used by the connection-test route + copy-from live test.
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

export type AppStoreConnectResponseState = "PUBLISHED" | "PENDING_PUBLISH";

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
  developer_response_id: string | null;
  developer_response_state: AppStoreConnectResponseState | null;
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
    state?: string;
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
    "fields[customerReviewResponses]": "responseBody,lastModifiedDate,state",
  });
  return `${ASC_BASE}/v1/apps/${appleAppStoreId}/customerReviews?${params.toString()}`;
}

function normalizeResponseState(raw: string | undefined): AppStoreConnectResponseState | null {
  if (raw === "PUBLISHED" || raw === "PENDING_PUBLISH") return raw;
  return null;
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
      developer_response_id: responseRow?.id ?? null,
      developer_response_state: normalizeResponseState(responseRow?.attributes?.state),
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

// =====================================================================
// Customer review responses — POST creates a reply to a review, DELETE
// removes it. Apple has no PATCH endpoint for review responses, so editing
// an existing reply is implemented at the call site as DELETE-then-POST.
// =====================================================================

export interface AppStoreConnectReviewResponse {
  id: string;
  body: string;
  state: AppStoreConnectResponseState | null;
  last_modified_at: Date | null;
}

interface AscResponsePayload {
  data: AscResponseRow;
}

/**
 * GET /v1/customerReviews/{id}?include=response — used as a fallback to recover
 * the ASC response id when a reply was created outside Owlmetry (so the daily
 * sync ingested the body but never recorded a `developer_response_id`). Returns
 * `not_found` if Apple has no response on file (already deleted externally).
 */
export async function fetchCustomerReviewResponseId(
  config: AppStoreConnectConfig,
  reviewExternalId: string,
): Promise<AppStoreConnectResult<string>> {
  const params = new URLSearchParams({
    include: "response",
    "fields[customerReviews]": "rating",
    "fields[customerReviewResponses]": "state",
  });
  const url = `${ASC_BASE}/v1/customerReviews/${encodeURIComponent(reviewExternalId)}?${params.toString()}`;
  const result = await ascSend<{ data: AscReviewRow; included?: AscResponseRow[] }>(
    config,
    "GET",
    url,
  );
  if (result.status !== "found") return result;
  const includedId = (result.data.included ?? []).find(
    (row) => row.type === "customerReviewResponses",
  )?.id;
  if (!includedId) return { status: "not_found" };
  return { status: "found", data: includedId };
}

/**
 * POST /v1/customerReviewResponses — Apple's character ceiling on responseBody is 5970.
 * The caller is expected to validate length before calling this.
 */
export async function createCustomerReviewResponse(
  config: AppStoreConnectConfig,
  reviewExternalId: string,
  body: string,
): Promise<AppStoreConnectResult<AppStoreConnectReviewResponse>> {
  const url = `${ASC_BASE}/v1/customerReviewResponses`;
  const payload = {
    data: {
      type: "customerReviewResponses",
      attributes: { responseBody: body },
      relationships: {
        review: {
          data: { type: "customerReviews", id: reviewExternalId },
        },
      },
    },
  };
  const result = await ascSend<AscResponsePayload>(config, "POST", url, payload);
  if (result.status !== "found") return result;

  const row = result.data.data;
  return {
    status: "found",
    data: {
      id: row.id,
      body: row.attributes?.responseBody ?? body,
      state: normalizeResponseState(row.attributes?.state),
      last_modified_at: parseDate(row.attributes?.lastModifiedDate),
    },
  };
}

/**
 * DELETE /v1/customerReviewResponses/{id} — irrecoverable on Apple's side; the
 * public reply disappears from the App Store listing. Caller is expected to
 * have prompted for confirmation before calling.
 */
export async function deleteCustomerReviewResponse(
  config: AppStoreConnectConfig,
  responseId: string,
): Promise<AppStoreConnectResult<void>> {
  const url = `${ASC_BASE}/v1/customerReviewResponses/${encodeURIComponent(responseId)}`;
  return ascSend<void>(config, "DELETE", url, undefined, { expectNoBody: true });
}
