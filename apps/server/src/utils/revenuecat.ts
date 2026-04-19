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

/**
 * Map a V2 active-entitlements response to the user-property set we store.
 * Output shape is unchanged from the V1 mapper so downstream consumers
 * (dashboards, segment filters) keep working.
 */
export function mapSubscriberToProperties(
  response: RevenueCatV2ActiveEntitlementsResponse,
): Record<string, string> {
  const props: Record<string, string> = {};
  const items = response.items ?? [];

  const hasActive = items.length > 0;
  props.rc_subscriber = hasActive ? "true" : "false";
  props.rc_status = hasActive ? "active" : "expired";

  if (items.length > 0) {
    props.rc_entitlements = items.map((e) => e.lookup_key).filter(Boolean).join(",");
    const firstProduct = items.find((e) => e.product_identifier)?.product_identifier;
    if (firstProduct) props.rc_product = firstProduct;
  }

  return props;
}
