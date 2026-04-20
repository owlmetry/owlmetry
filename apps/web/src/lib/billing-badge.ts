export interface BillingBadgeState {
  isCancelledTrial: boolean;
  isTrial: boolean;
  isPaid: boolean;
  showCancelledBadge: boolean;
}

/**
 * Derive the billing-badge state (red cancelled trial / sky trial / green paid +
 * optional secondary "Cancelled" badge) from a user's RevenueCat-derived
 * properties. Keeps `users/page.tsx` and `recent-users-panel.tsx` in lockstep.
 */
export function getBillingBadgeState(
  properties: Record<string, string> | null | undefined,
): BillingBadgeState {
  const props = properties ?? {};
  const isTrial = props.rc_period_type === "trial";
  const willRenew = props.rc_will_renew !== "false";
  return {
    isCancelledTrial: isTrial && !willRenew,
    isTrial: isTrial && willRenew,
    isPaid: !isTrial && props.rc_subscriber === "true",
    showCancelledBadge: props.rc_status === "cancelled" && !isTrial,
  };
}
