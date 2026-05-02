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

export interface RevenueCatV2ActiveEntitlement {
  object: "customer.active_entitlement";
  entitlement_id: string;
  lookup_key: string;
  display_name: string | null;
  product_identifier: string;
  expires_at: number | null; // ms epoch, null for lifetime
}

export interface RevenueCatV2ActiveEntitlementsResponse {
  object: "list";
  items: RevenueCatV2ActiveEntitlement[];
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

const RC_V2_BASE = "https://api.revenuecat.com/v2";
const REQUEST_TIMEOUT_MS = 10_000;

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
 * Map a V2 active-entitlements response (and, optionally, a subscriptions
 * response) to the user-property set we store. Output keys are stable across
 * webhook/sync so downstream consumers (dashboards, segment filters) keep
 * working.
 */
export function mapSubscriberToProperties(
  response: RevenueCatV2ActiveEntitlementsResponse,
  subscriptions?: RevenueCatV2SubscriptionsResponse,
): Record<string, string> {
  const props: Record<string, string> = {};
  const items = response.items ?? [];

  const hasActive = items.length > 0;

  if (items.length > 0) {
    props.rc_entitlements = items.map((e) => e.lookup_key).filter(Boolean).join(",");
    const firstProduct = items.find((e) => e.product_identifier)?.product_identifier;
    if (firstProduct) props.rc_product = firstProduct;
  }

  let willRenew = true;
  let rcStatus: string = hasActive ? "active" : "expired";

  if (subscriptions) {
    const primary = pickPrimarySubscription(subscriptions.items ?? []);
    if (primary) {
      willRenew = computeWillRenew(primary);
      rcStatus = normalizeSubscriptionStatus(primary.status);
      const periodType = derivePeriodType(primary);
      if (periodType) props.rc_period_type = periodType;
      const billingPeriod = computeBillingPeriod(
        primary.current_period_starts_at,
        primary.current_period_ends_at,
      );
      if (billingPeriod) props.rc_billing_period = billingPeriod;
    } else if (hasActive) {
      // Entitlement active but no subscription → lifetime grant or promotional entitlement.
      props.rc_billing_period = "lifetime";
      props.rc_period_type = "promotional";
    }
  }

  // `rc_subscriber` means "user has a live, renewing subscription". A cancelled
  // trial still has live entitlements but will not renew, so it must report
  // false here — otherwise the dashboard shows them as "💰 Paid".
  props.rc_subscriber = hasActive && willRenew ? "true" : "false";
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
