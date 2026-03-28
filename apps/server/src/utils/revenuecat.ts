export interface RevenueCatConfig {
  api_key: string;
  webhook_secret: string;
}

export interface RevenueCatSubscriberResponse {
  request_date: string;
  request_date_ms: number;
  subscriber: {
    entitlements: Record<string, {
      expires_date: string | null;
      grace_period_expires_date: string | null;
      product_identifier: string;
      purchase_date: string;
    }>;
    first_seen: string;
    last_seen: string;
    management_url: string | null;
    non_subscriptions: Record<string, Array<{
      id: string;
      is_sandbox: boolean;
      purchase_date: string;
      store: string;
    }>>;
    original_app_user_id: string;
    subscriptions: Record<string, {
      auto_resume_date: string | null;
      billing_issues_detected_at: string | null;
      expires_date: string;
      is_sandbox: boolean;
      original_purchase_date: string;
      period_type: string;
      purchase_date: string;
      store: string;
      unsubscribe_detected_at: string | null;
    }>;
  };
}

export function mapSubscriberToProperties(subscriber: RevenueCatSubscriberResponse["subscriber"]): Record<string, string> {
  const props: Record<string, string> = {};

  const entitlementNames = Object.keys(subscriber.entitlements);
  const hasActive = entitlementNames.some((name) => {
    const ent = subscriber.entitlements[name];
    return !ent.expires_date || new Date(ent.expires_date) > new Date();
  });

  props.rc_subscriber = hasActive ? "true" : "false";
  props.rc_status = hasActive ? "active" : "expired";

  if (entitlementNames.length > 0) {
    props.rc_entitlements = entitlementNames.join(",");
  }

  const products = entitlementNames
    .map((name) => subscriber.entitlements[name].product_identifier)
    .filter(Boolean);
  if (products.length > 0) {
    props.rc_product = products[0];
  }

  return props;
}

export async function fetchRevenueCatSubscriber(
  apiKey: string,
  userId: string,
): Promise<RevenueCatSubscriberResponse | null> {
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as RevenueCatSubscriberResponse;
  } catch {
    return null;
  }
}
