export interface RevenueCatConfig {
  api_key: string;
  webhook_secret: string;
}

// RevenueCat V2 API response shapes.
// https://www.revenuecat.com/reference/api-v2

export interface RevenueCatV2Project {
  object: "project";
  id: string;
  name: string;
  created_at: number;
}

export interface RevenueCatV2ListProjectsResponse {
  object: "list";
  items: RevenueCatV2Project[];
  next_page: string | null;
  url: string;
}

// Per-customer active entitlement. RC's V2 `/customers/{id}/active_entitlements`
// returns ONLY `entitlement_id` + `expires_at` per item — no `lookup_key`,
// `display_name`, or `product_identifier` (verified against a live response on
// 2026-05-19). To get human-readable lookup keys, fetch the project-scoped
// entitlement list via `fetchRevenueCatProjectEntitlements` and cross-reference
// by `entitlement_id`.
export interface RevenueCatV2ActiveEntitlement {
  object: "customer.active_entitlement";
  entitlement_id: string;
  expires_at: number | null; // ms epoch, null for lifetime
}

export interface RevenueCatV2ActiveEntitlementsResponse {
  object: "list";
  items: RevenueCatV2ActiveEntitlement[];
  next_page: string | null;
  url: string;
}

// Project-scoped entitlement definition. `id` matches the `entitlement_id`
// returned per-customer; `lookup_key` is the human-readable name configured in
// the RC dashboard (e.g. "pro"). Fetched once per sync and used as a
// `entitlement_id → lookup_key` map.
export interface RevenueCatV2Entitlement {
  object: "entitlement";
  id: string;
  project_id: string;
  lookup_key: string;
  display_name: string | null;
  state: string;
  created_at: number;
}

export interface RevenueCatV2EntitlementsResponse {
  object: "list";
  items: RevenueCatV2Entitlement[];
  next_page: string | null;
  url: string;
}

// Project-scoped product definition. V2 per-customer endpoints
// (`/subscriptions`, `/purchases`) carry the opaque RC product `id`
// (e.g. `prod756dd4c17f`) — `store_identifier` is the App Store / Play Store
// SKU (e.g. `3dk_2999_lt`) that webhook events already populate as
// `rc_product`. Fetched once per sync to translate opaque IDs to SKUs.
export interface RevenueCatV2Product {
  object: "product";
  id: string;
  store_identifier: string;
  display_name: string | null;
  type: string;
  state: string;
  app_id: string;
}

export interface RevenueCatV2ProductsResponse {
  object: "list";
  items: RevenueCatV2Product[];
  next_page: string | null;
  url: string;
}

// V2 customer attribute — reserved (`$`-prefixed) and custom attributes both
// share this shape. Returned as a list inside the customer object when the
// endpoint is called with `?expand=attributes`.
export interface RevenueCatV2Attribute {
  object: "customer.attribute";
  name: string;
  value: string;
  updated_at: number;
}

export interface RevenueCatV2CustomerAttributes {
  object: "list";
  items: RevenueCatV2Attribute[];
  next_page: string | null;
  url: string;
}

// V2 customer object with `?expand=attributes`. Other expand options exist
// (active_entitlements, subscriptions) but we only need attributes here —
// entitlements and subscriptions have their own helpers below.
export interface RevenueCatV2CustomerExpanded {
  object: "customer";
  id: string;
  project_id: string;
  first_seen_at: number;
  last_seen_at: number;
  last_seen_country: string | null;
  last_seen_platform: string | null;
  last_seen_platform_version: string | null;
  last_seen_app_version: string | null;
  attributes?: RevenueCatV2CustomerAttributes;
}

// V2 subscription object. Fields below are the ones we consume — the real
// response has more (entitlements, store metadata, etc).
export interface RevenueCatV2Subscription {
  object: "subscription";
  id: string;
  customer_id: string;
  product_id: string;
  starts_at: number;
  current_period_starts_at: number;
  current_period_ends_at: number | null;
  ends_at: number | null;
  status: string; // "trialing" | "active" | "in_grace_period" | "cancelled" | "expired" | ...
  auto_renewal_status?: string; // "will_renew" | "will_not_renew" | "requires_price_increase_consent" | ...
  gives_access: boolean;
  store: string;
  ownership: string;
  // RC pre-computes lifetime USD revenue per subscription as a breakdown
  // (gross = what the customer paid; proceeds = what we received after
  // Apple/Google commission and tax; refunds already netted by RC). We sum
  // `gross` across `items` for the customer's lifetime value — that's the
  // customer LTV, not our take-home, and matches what "revenue" means on the
  // dashboard column.
  total_revenue_in_usd?: {
    gross?: number;
    proceeds?: number;
    commission?: number;
    tax?: number;
    currency?: string;
  };
}

export interface RevenueCatV2SubscriptionsResponse {
  object: "list";
  items: RevenueCatV2Subscription[];
  next_page: string | null;
  url: string;
}

// V2 non-subscription purchase object (one-time IAPs: lifetime / consumable / non-consumable).
// RC's `/customers/{id}/purchases` lists these — they don't appear in `/subscriptions`.
// Note: the revenue breakdown is `revenue_in_usd` here, NOT `total_revenue_in_usd`
// as on subscriptions — confirmed against a live response on 2026-05-19. Same
// inner shape (gross / proceeds / commission / tax / currency), just a different
// outer key. RC's V2 naming is inconsistent across line-item types.
export interface RevenueCatV2NonSubscription {
  object: "non_subscription" | "purchase" | string;
  id: string;
  customer_id?: string;
  product_id?: string;
  purchased_at?: number;
  store?: string;
  revenue_in_usd?: {
    gross?: number;
    proceeds?: number;
    commission?: number;
    tax?: number;
    currency?: string;
  };
}

export interface RevenueCatV2NonSubscriptionsResponse {
  object: "list";
  items: RevenueCatV2NonSubscription[];
  next_page: string | null;
  url: string;
}

const RC_V2_BASE = "https://api.revenuecat.com/v2";
const REQUEST_TIMEOUT_MS = 10_000;

// RC's anonymous-customer prefix. Distinct from Owlmetry's `owl_anon_`, so
// `mergeUserProperties` would NOT flag these as `is_anonymous=true` on its
// own — every code path that ingests an RC user_id must filter this out
// explicitly to avoid polluting the /dashboard/ads attribution rollup with
// non-attributable rows.
export const RC_ANONYMOUS_PREFIX = "$RCAnonymousID:";

function rcHeaders(apiKey: string) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

async function readBodyPreview(res: Response): Promise<string | undefined> {
  try {
    const body = await res.text();
    if (!body) return undefined;
    // RevenueCat error responses are JSON like { "message": "...", "type": "...", "doc_url": "..." }.
    // Surface the `message` field directly so it propagates into job results cleanly
    // (e.g. "The API key needs at least the project_configuration:projects:read permission defined").
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.message === "string" && parsed.message.length > 0) {
        return parsed.message.slice(0, 500);
      }
    } catch {
      // Not JSON — fall through to raw preview.
    }
    return body.slice(0, 500);
  } catch {
    return undefined;
  }
}

export type FetchProjectIdResult =
  | { status: "found"; projectId: string }
  | { status: "no_projects" }
  | { status: "error"; statusCode?: number; message?: string };

/**
 * Resolve the RevenueCat project ID for the given V2 secret API key.
 * V2 secret keys are project-scoped — `/v2/projects` returns exactly one item
 * for typical project-level secret keys.
 */
export async function fetchRevenueCatProjectId(apiKey: string): Promise<FetchProjectIdResult> {
  try {
    const res = await fetch(`${RC_V2_BASE}/projects`, {
      headers: rcHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { status: "error", statusCode: res.status, message: await readBodyPreview(res) };
    }
    const data = (await res.json()) as RevenueCatV2ListProjectsResponse;
    const first = data.items?.[0];
    if (!first) return { status: "no_projects" };
    return { status: "found", projectId: first.id };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

// V2 customer object as returned in the `items` array of the list-customers
// endpoint. Includes more fields than `RevenueCatV2CustomerExpanded` because
// RC inlines `active_entitlements` and `experiment` in the list response,
// but for the backfill iterator we only consume `id` — the rest is included
// for completeness and future use.
export interface RevenueCatV2Customer {
  object: "customer";
  id: string;
  project_id: string;
  first_seen_at: number;
  last_seen_at: number;
  last_seen_country: string | null;
  last_seen_platform: string | null;
  last_seen_platform_version: string | null;
  last_seen_app_version: string | null;
  active_entitlements?: RevenueCatV2ActiveEntitlementsResponse;
  experiment?: unknown;
  attributes?: RevenueCatV2CustomerAttributes;
}

export interface RevenueCatV2ListCustomersResponse {
  object: "list";
  items: RevenueCatV2Customer[];
  next_page: string | null;
  url: string;
}

export type FetchCustomersResult =
  | { status: "found"; items: RevenueCatV2Customer[]; nextStartingAfter: string | null }
  | { status: "error"; statusCode?: number; message?: string };

/**
 * Page the RevenueCat V2 list-customers endpoint. Pagination is forward-only
 * via the `starting_after` cursor (the V2 list-endpoint convention); RC
 * returns a `next_page` URL — we parse the `starting_after` query param off it
 * so callers don't have to handle URLs.
 *
 * Permission required on the API key: customer_information:customers:read
 * (covered by the same "Customer information: Read only" scope as the
 * per-customer fetchers).
 *
 * Rate limit: shares the 480 req/min Customer Information domain budget with
 * the per-customer endpoints. List calls are cheap (1 per page, default 100
 * customers/page) so per-customer cost dominates.
 */
export async function fetchRevenueCatCustomers(
  apiKey: string,
  rcProjectId: string,
  options: { startingAfter?: string | null; limit?: number } = {},
): Promise<FetchCustomersResult> {
  const limit = options.limit ?? 100;
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.startingAfter) params.set("starting_after", options.startingAfter);
  const url = `${RC_V2_BASE}/projects/${encodeURIComponent(rcProjectId)}/customers?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: rcHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { status: "error", statusCode: res.status, message: await readBodyPreview(res) };
    }
    const data = (await res.json()) as RevenueCatV2ListCustomersResponse;
    return {
      status: "found",
      items: data.items ?? [],
      nextStartingAfter: parseStartingAfterFromNextPage(data.next_page),
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

// RC's `next_page` is a URL like `/v2/projects/proj_x/customers?starting_after=cust_y&limit=100`.
// Pull the `starting_after` query param so the caller works in cursor space.
function parseStartingAfterFromNextPage(nextPage: string | null | undefined): string | null {
  if (!nextPage) return null;
  try {
    // URL constructor needs an absolute base; doesn't matter what we pass since
    // we only read the query.
    const parsed = new URL(nextPage, "https://api.revenuecat.com");
    return parsed.searchParams.get("starting_after");
  } catch {
    return null;
  }
}

export type FetchSubscriberResult =
  | { status: "found"; data: RevenueCatV2ActiveEntitlementsResponse }
  | { status: "not_found" }
  | { status: "error"; statusCode?: number; message?: string };

/**
 * Fetch the currently-active entitlements for a RevenueCat customer via the V2 API.
 * Returns `not_found` only when the customer does not exist in RevenueCat;
 * an existing customer with no active entitlements returns `found` with an empty list.
 */
export async function fetchRevenueCatSubscriber(
  apiKey: string,
  rcProjectId: string,
  userId: string,
): Promise<FetchSubscriberResult> {
  try {
    const url = `${RC_V2_BASE}/projects/${encodeURIComponent(rcProjectId)}/customers/${encodeURIComponent(userId)}/active_entitlements`;
    const res = await fetch(url, {
      headers: rcHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      return { status: "found", data: (await res.json()) as RevenueCatV2ActiveEntitlementsResponse };
    }
    if (res.status === 404) return { status: "not_found" };
    return { status: "error", statusCode: res.status, message: await readBodyPreview(res) };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export type FetchSubscriptionsResult =
  | { status: "found"; data: RevenueCatV2SubscriptionsResponse }
  | { status: "not_found" }
  | { status: "error"; statusCode?: number; message?: string };

/**
 * Fetch a customer's subscriptions from the V2 API. Used to enrich sync results
 * with trial status and billing-period data (the entitlements endpoint doesn't
 * expose either).
 */
export async function fetchRevenueCatSubscriptions(
  apiKey: string,
  rcProjectId: string,
  userId: string,
): Promise<FetchSubscriptionsResult> {
  try {
    const url = `${RC_V2_BASE}/projects/${encodeURIComponent(rcProjectId)}/customers/${encodeURIComponent(userId)}/subscriptions`;
    const res = await fetch(url, {
      headers: rcHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      return { status: "found", data: (await res.json()) as RevenueCatV2SubscriptionsResponse };
    }
    if (res.status === 404) return { status: "not_found" };
    return { status: "error", statusCode: res.status, message: await readBodyPreview(res) };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export type FetchNonSubscriptionsResult =
  | { status: "found"; data: RevenueCatV2NonSubscriptionsResponse }
  | { status: "not_found" }
  | { status: "unavailable"; statusCode: number }
  | { status: "error"; statusCode?: number; message?: string };

/**
 * Fetch a customer's non-subscription purchases (one-time IAPs) from the V2
 * API. Most users with an active entitlement but an empty `/subscriptions`
 * response are actually on a paid lifetime IAP — not a promotional grant.
 * Without this call we'd misreport `rc_period_type=promotional` and zero
 * revenue for those users.
 *
 * The non-subscriptions endpoint is newer than `/subscriptions`; older
 * RevenueCat plans may return 405/501/410. `unavailable` distinguishes that
 * from a transient error so callers can degrade silently instead of warning
 * on every sync.
 */
export async function fetchRevenueCatNonSubscriptions(
  apiKey: string,
  rcProjectId: string,
  userId: string,
): Promise<FetchNonSubscriptionsResult> {
  try {
    const url = `${RC_V2_BASE}/projects/${encodeURIComponent(rcProjectId)}/customers/${encodeURIComponent(userId)}/purchases`;
    const res = await fetch(url, {
      headers: rcHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      return { status: "found", data: (await res.json()) as RevenueCatV2NonSubscriptionsResponse };
    }
    if (res.status === 404) return { status: "not_found" };
    if (res.status === 405 || res.status === 410 || res.status === 501) {
      return { status: "unavailable", statusCode: res.status };
    }
    return { status: "error", statusCode: res.status, message: await readBodyPreview(res) };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

// Page through an RC V2 list endpoint until `next_page` is exhausted.
// Distinct from `fetchRevenueCatCustomers` which exposes per-page cursors so
// the backfill job can drive its own loop with cancellation + page-size
// probing — this helper is for callers that want every item in one go.
async function fetchAllPaged<TItem>(
  apiKey: string,
  buildUrl: (startingAfter: string | null) => string,
): Promise<{ status: "found"; items: TItem[] } | { status: "error"; statusCode?: number; message?: string }> {
  const items: TItem[] = [];
  let startingAfter: string | null = null;
  try {
    while (true) {
      const res = await fetch(buildUrl(startingAfter), {
        headers: rcHeaders(apiKey),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { status: "error", statusCode: res.status, message: await readBodyPreview(res) };
      }
      const data = (await res.json()) as { items?: TItem[]; next_page?: string | null };
      items.push(...(data.items ?? []));
      startingAfter = parseStartingAfterFromNextPage(data.next_page ?? null);
      if (!startingAfter) break;
    }
    return { status: "found", items };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

function buildPagedUrl(rcProjectId: string, path: string, startingAfter: string | null): string {
  const params = new URLSearchParams({ limit: "100" });
  if (startingAfter) params.set("starting_after", startingAfter);
  return `${RC_V2_BASE}/projects/${encodeURIComponent(rcProjectId)}/${path}?${params.toString()}`;
}

export type FetchProjectEntitlementsResult =
  | { status: "found"; items: RevenueCatV2Entitlement[] }
  | { status: "error"; statusCode?: number; message?: string };

/**
 * Fetch the project-scoped list of entitlement definitions. Each item carries
 * an `id` (matches per-customer `entitlement_id`) and a human-readable
 * `lookup_key`. Callers build a `entitlement_id → lookup_key` map and pass it
 * to `mapSubscriberToProperties` so `rc_entitlements` shows "pro" rather than
 * "entl417ac4ef04" (or worse, "" as it was prior to 2026-05-19).
 *
 * Pages until RC's `next_page` cursor is exhausted. Most projects have <20
 * entitlements, so usually one request.
 */
export function fetchRevenueCatProjectEntitlements(
  apiKey: string,
  rcProjectId: string,
): Promise<FetchProjectEntitlementsResult> {
  return fetchAllPaged<RevenueCatV2Entitlement>(apiKey, (sa) =>
    buildPagedUrl(rcProjectId, "entitlements", sa),
  );
}

export type FetchProjectProductsResult =
  | { status: "found"; items: RevenueCatV2Product[] }
  | { status: "error"; statusCode?: number; message?: string };

/**
 * Fetch the project-scoped list of products. Each item's `id` matches the
 * opaque `product_id` field on V2 `/subscriptions` and `/purchases` items;
 * `store_identifier` is the App Store / Play Store SKU we surface as
 * `rc_product`. Mirrors the webhook handler's behaviour (webhook events
 * already use store-side IDs in `event.product_id`).
 */
export function fetchRevenueCatProjectProducts(
  apiKey: string,
  rcProjectId: string,
): Promise<FetchProjectProductsResult> {
  return fetchAllPaged<RevenueCatV2Product>(apiKey, (sa) =>
    buildPagedUrl(rcProjectId, "products", sa),
  );
}

export type FetchCustomerAttributesResult =
  | { status: "found"; attributes: RevenueCatV2Attribute[] }
  | { status: "not_found" }
  | { status: "error"; statusCode?: number; message?: string };

/**
 * Fetch a RevenueCat customer's reserved + custom attributes via the V2 API.
 * Used to backfill Apple Search Ads attribution for users who predate our
 * first-party AdServices flow — RC has been collecting `$mediaSource`,
 * `$campaign`, `$adGroup`, `$keyword` since their SDK was installed.
 */
export async function fetchRevenueCatCustomerAttributes(
  apiKey: string,
  rcProjectId: string,
  userId: string,
): Promise<FetchCustomerAttributesResult> {
  try {
    const url = `${RC_V2_BASE}/projects/${encodeURIComponent(rcProjectId)}/customers/${encodeURIComponent(userId)}?expand=attributes`;
    const res = await fetch(url, {
      headers: rcHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as RevenueCatV2CustomerExpanded;
      return { status: "found", attributes: data.attributes?.items ?? [] };
    }
    if (res.status === 404) return { status: "not_found" };
    return { status: "error", statusCode: res.status, message: await readBodyPreview(res) };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

const DAY_MS = 86_400_000;

/**
 * Bucket a duration (or null for lifetime) into a human-readable billing-period
 * label. Matches the common App Store / Play Store subscription cadences and
 * falls back to `lifetime` for anything open-ended or wildly over a year.
 *
 * Caveat: during a free trial, the subscription's current_period reflects the
 * trial length (e.g. 3 days) rather than the contracted cadence. Callers that
 * can detect trial state should consider that — for the Users list UI we
 * already render the Trial badge separately, so this minor imprecision is fine.
 */
export function computeBillingPeriod(startMs: number, endMs: number | null): string | undefined {
  if (endMs === null) return "lifetime";
  const diffDays = (endMs - startMs) / DAY_MS;
  if (!Number.isFinite(diffDays) || diffDays <= 0) return undefined;
  if (diffDays < 10) return "weekly";
  if (diffDays < 20) return "two_weeks";
  if (diffDays < 40) return "monthly";
  if (diffDays < 70) return "two_months";
  if (diffDays < 100) return "three_months";
  if (diffDays < 200) return "six_months";
  if (diffDays < 400) return "yearly";
  return "lifetime";
}

/**
 * Pick the subscription we should derive rc_period_type / rc_billing_period from.
 * Prefer one that currently grants access (gives_access: true or a trialing/active/grace status);
 * otherwise fall back to the latest by current_period_starts_at.
 */
function pickPrimarySubscription(
  subs: RevenueCatV2Subscription[],
): RevenueCatV2Subscription | undefined {
  if (subs.length === 0) return undefined;
  const live = subs.filter(
    (s) => s.gives_access || s.status === "trialing" || s.status === "active" || s.status === "grace_period",
  );
  const pool = live.length > 0 ? live : subs;
  return [...pool].sort((a, b) => b.current_period_starts_at - a.current_period_starts_at)[0];
}

const TRIAL_PERIOD_LENGTH_CUTOFF_DAYS = 16;

/**
 * Derive the period-type bucket (`trial` / `normal`) from a V2 subscription.
 * For live statuses we trust the status directly; for terminal/cancelled
 * statuses we fall back to the current period's length as a heuristic — a
 * cancelled-but-still-entitled subscription keeps the original period length,
 * so a < ~16 day period almost certainly reflects a trial.
 */
function derivePeriodType(sub: RevenueCatV2Subscription): string | undefined {
  if (sub.status === "trialing") return "trial";
  if (sub.status === "active" || sub.status === "grace_period" || sub.status === "in_grace_period") {
    return "normal";
  }
  if (sub.current_period_ends_at !== null) {
    const diffDays = (sub.current_period_ends_at - sub.current_period_starts_at) / DAY_MS;
    if (Number.isFinite(diffDays) && diffDays > 0) {
      return diffDays < TRIAL_PERIOD_LENGTH_CUTOFF_DAYS ? "trial" : "normal";
    }
  }
  return undefined;
}

/** Map V2 subscription `status` into our stored `rc_status` vocabulary. */
function normalizeSubscriptionStatus(status: string): string {
  if (status === "trialing") return "trialing";
  if (status === "cancelled") return "cancelled";
  if (status === "active") return "active";
  if (status === "grace_period" || status === "in_grace_period") return "active";
  return "expired";
}

/** Did RevenueCat tell us this subscription will auto-renew? Defaults to true (fail-open). */
function computeWillRenew(sub: RevenueCatV2Subscription): boolean {
  if (sub.auto_renewal_status === "will_not_renew") return false;
  return true;
}

/**
 * Optional lookup maps consulted by `mapSubscriberToProperties` to translate
 * opaque RC IDs returned by the per-customer V2 endpoints into the
 * human-readable identifiers the dashboard expects:
 *
 * - `entitlementKeyById`: `entitlement_id → lookup_key`. The per-customer
 *   `/active_entitlements` endpoint returns only `entitlement_id`, so without
 *   this map `rc_entitlements` falls back to the raw opaque ID.
 * - `productSkuById`: `product_id → store_identifier`. V2 `/subscriptions` and
 *   `/purchases` return RC's opaque `product_id` (e.g. `prod756dd4c17f`); we
 *   surface the store-side SKU (e.g. `3dk_2999_lt`) to match webhook behaviour.
 *
 * Both maps are populated by calling `fetchRevenueCatProjectEntitlements` and
 * `fetchRevenueCatProjectProducts` once per project-sync and passing the maps
 * through to every per-user invocation.
 */
export interface RevenueCatLookupMaps {
  entitlementKeyById?: Map<string, string>;
  productSkuById?: Map<string, string>;
}

/**
 * Map a V2 active-entitlements response (and, optionally, a subscriptions
 * response + non-subscriptions response) to the user-property set we store.
 * Output keys are stable across webhook/sync so downstream consumers
 * (dashboards, segment filters) keep working.
 *
 * When `subscriptions` returns an empty list, the user is almost always on a
 * paid non-subscription IAP (lifetime / consumable) — pass `nonSubscriptions`
 * to distinguish that from a true promotional grant. With no subs AND no
 * non-subs but an active entitlement, the entitlement was granted by RC
 * dashboard / admin tooling and `rc_period_type` is left unset rather than
 * mislabeled as "promotional" or "lifetime".
 *
 * Pass `lookups` to translate opaque RC IDs into human-readable identifiers
 * (see `RevenueCatLookupMaps`). Without them, `rc_entitlements` and
 * `rc_product` fall back to raw IDs — better than the pre-2026-05-19
 * behaviour of emitting empty strings, but the dashboard will show opaque
 * `entl…` / `prod…` strings until the maps are supplied.
 */
export function mapSubscriberToProperties(
  response: RevenueCatV2ActiveEntitlementsResponse,
  subscriptions?: RevenueCatV2SubscriptionsResponse,
  nonSubscriptions?: RevenueCatV2NonSubscriptionsResponse,
  lookups?: RevenueCatLookupMaps,
): Record<string, string> {
  const props: Record<string, string> = {};
  const items = response.items ?? [];

  const hasActive = items.length > 0;
  const hasNonSub = (nonSubscriptions?.items?.length ?? 0) > 0;

  if (items.length > 0) {
    const entitlementKeyById = lookups?.entitlementKeyById;
    const labels = items
      .map((e) => entitlementKeyById?.get(e.entitlement_id) ?? e.entitlement_id)
      .filter((label): label is string => Boolean(label));
    if (labels.length > 0) {
      props.rc_entitlements = labels.join(",");
    }
  }

  let willRenew = true;
  let rcStatus: string = hasActive ? "active" : "expired";

  // Resolve `rc_product` from the primary subscription's product_id (or first
  // non-sub for lifetime IAPs), translated to a store-side SKU via the lookup
  // map. Falls back to the raw opaque RC product_id if the map is missing or
  // doesn't cover this product.
  const primarySub = subscriptions ? pickPrimarySubscription(subscriptions.items ?? []) : undefined;
  const rawProductId =
    primarySub?.product_id ?? (hasNonSub ? nonSubscriptions?.items?.[0]?.product_id : undefined);
  if (rawProductId) {
    props.rc_product = lookups?.productSkuById?.get(rawProductId) ?? rawProductId;
  }

  if (subscriptions) {
    if (primarySub) {
      willRenew = computeWillRenew(primarySub);
      rcStatus = normalizeSubscriptionStatus(primarySub.status);
      const periodType = derivePeriodType(primarySub);
      if (periodType) props.rc_period_type = periodType;
      const billingPeriod = computeBillingPeriod(
        primarySub.current_period_starts_at,
        primarySub.current_period_ends_at,
      );
      if (billingPeriod) props.rc_billing_period = billingPeriod;
    } else if (hasNonSub) {
      // Active entitlement backed by a paid one-time IAP (lifetime / non-renewing).
      // The user IS a paying customer but won't renew (no subscription cycle).
      props.rc_billing_period = "lifetime";
      props.rc_period_type = "lifetime";
      willRenew = false;
    } else if (hasActive) {
      // Active entitlement with no sub AND no non-sub purchase — admin-granted
      // promotional entitlement (RC dashboard "Grant" feature).
      props.rc_billing_period = "lifetime";
      props.rc_period_type = "promotional";
    }
  } else if (hasNonSub && hasActive) {
    // Subs endpoint failed but non-sub purchases exist — still distinguish from
    // a promo grant. willRenew stays at the default true since we have no
    // signal otherwise; rc_subscriber gates the Paid badge anyway.
    props.rc_billing_period = "lifetime";
    props.rc_period_type = "lifetime";
    willRenew = false;
  }

  // `rc_subscriber` means "user has a live, paying entitlement". For renewing
  // subscriptions this requires `willRenew=true` (a cancelled trial flips this
  // false so it doesn't render as "💰 Paid"). For one-time paid IAPs
  // (`rc_period_type=lifetime`), the purchase is paid and active regardless of
  // willRenew — they bought it once, they own it.
  const isLifetimePaid = props.rc_period_type === "lifetime";
  props.rc_subscriber = hasActive && (willRenew || isLifetimePaid) ? "true" : "false";
  props.rc_status = rcStatus;
  props.rc_will_renew = willRenew ? "true" : "false";

  return props;
}

/**
 * Sum a customer's lifetime USD revenue across their V2 subscriptions, using
 * the `gross` leg of RC's revenue breakdown (refunds already netted by RC).
 * Returns null when the response is missing; otherwise non-negative number
 * (subscriptions without a usable gross contribute 0).
 */
export function sumLifetimeRevenueUsd(
  subscriptions: RevenueCatV2SubscriptionsResponse | undefined,
): number | null {
  if (!subscriptions) return null;
  const items = subscriptions.items ?? [];
  if (items.length === 0) return 0;
  let total = 0;
  for (const sub of items) {
    const gross = sub.total_revenue_in_usd?.gross;
    if (typeof gross === "number" && Number.isFinite(gross)) {
      total += gross;
    }
  }
  return total < 0 ? 0 : total;
}

/**
 * Sum lifetime USD revenue across a customer's non-subscription purchases.
 * Mirrors `sumLifetimeRevenueUsd` semantics — same `total_revenue_in_usd.gross`
 * shape, missing-fields contribute 0, null when response is absent so callers
 * can distinguish "endpoint unavailable" (don't touch the column) from "user
 * has no non-sub purchases" (contributes 0).
 */
export function sumLifetimeRevenueUsdFromNonSubs(
  nonSubscriptions: RevenueCatV2NonSubscriptionsResponse | undefined,
): number | null {
  if (!nonSubscriptions) return null;
  const items = nonSubscriptions.items ?? [];
  if (items.length === 0) return 0;
  let total = 0;
  for (const purchase of items) {
    const gross = purchase.revenue_in_usd?.gross;
    if (typeof gross === "number" && Number.isFinite(gross)) {
      total += gross;
    }
  }
  return total < 0 ? 0 : total;
}
