export interface BillingBadgeState {
  isCancelledTrial: boolean;
  isTrial: boolean;
  isPaid: boolean;
  showCancelledBadge: boolean;
  /** Tooltip copy for the primary badge (Trial/Paid). `null` when no primary badge is rendered. */
  primaryTooltip: string | null;
  /** Tooltip copy for the secondary "Cancelled" badge. `null` when it's not rendered. */
  cancelledTooltip: string | null;
}

const TOOLTIPS = {
  cancelledTrial:
    "Free trial that was cancelled. Access continues until the trial period ends, but the subscription will not auto-renew into a paid plan.",
  activeTrial:
    "Currently in a free trial that will auto-renew into a paid subscription at the end of the trial period.",
  paid:
    "Active paying subscriber — will auto-renew at the end of the current billing period.",
  cancelledPaid:
    "Paid subscription was cancelled. Access continues until the end of the current billing period, then will not renew.",
} as const;

/**
 * Derive the billing-badge state (red cancelled trial / sky trial / green paid +
 * optional secondary "Cancelled" badge) from a user's RevenueCat-derived
 * properties. Keeps `users/page.tsx` and `recent-users-panel.tsx` in lockstep.
 */
export function getBillingBadgeState(
  properties: Record<string, string> | null | undefined,
): BillingBadgeState {
  const props = properties ?? {};
  const isTrialPeriod = props.rc_period_type === "trial";
  const willRenew = props.rc_will_renew !== "false";
  const isCancelledTrial = isTrialPeriod && !willRenew;
  const isTrial = isTrialPeriod && willRenew;
  const isPaid = !isTrialPeriod && props.rc_subscriber === "true";
  const showCancelledBadge = props.rc_status === "cancelled" && !isTrialPeriod;

  let primaryTooltip: string | null = null;
  if (isCancelledTrial) primaryTooltip = TOOLTIPS.cancelledTrial;
  else if (isTrial) primaryTooltip = TOOLTIPS.activeTrial;
  else if (isPaid) primaryTooltip = TOOLTIPS.paid;

  return {
    isCancelledTrial,
    isTrial,
    isPaid,
    showCancelledBadge,
    primaryTooltip,
    cancelledTooltip: showCancelledBadge ? TOOLTIPS.cancelledPaid : null,
  };
}
