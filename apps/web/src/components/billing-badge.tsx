"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getBillingBadgeState } from "@/lib/billing-badge";

interface BillingBadgeProps {
  properties: Record<string, string> | null | undefined;
  size?: "default" | "sm";
}

function humanizeRcKey(key: string): string {
  const stripped = key.startsWith("rc_") ? key.slice(3) : key;
  const words = stripped.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function SubscriptionTooltipBody({
  description,
  properties,
}: {
  description: string | null;
  properties: Record<string, string> | null | undefined;
}) {
  const rcEntries = properties
    ? Object.entries(properties)
        .filter(([k]) => k.startsWith("rc_"))
        .sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <div className="space-y-1.5 text-xs">
      {description && <div>{description}</div>}
      {rcEntries.length > 0 && (
        <div className="space-y-0.5 border-t border-border pt-1.5">
          {rcEntries.map(([k, v]) => (
            <div key={k}>
              <span className="text-muted-foreground">{humanizeRcKey(k)}:</span> {v}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders at most one subscription-state badge. Cancellation takes
 * precedence over the active Paid color so a cancelled paying user isn't
 * visually indistinguishable from an active one.
 */
export function BillingBadge({ properties, size = "default" }: BillingBadgeProps) {
  const state = getBillingBadgeState(properties);
  const badgeSize = size === "sm" ? "sm" : "md";

  let badge: ReactNode = null;
  let description: string | null = null;

  if (state.isCancelledTrial) {
    badge = <Badge variant="default" tone="red" size={badgeSize}>🎁 Trial</Badge>;
    description = state.primaryTooltip;
  } else if (state.showCancelledBadge) {
    badge = <Badge variant="secondary" size={badgeSize}>🚫 Cancelled</Badge>;
    description = state.cancelledTooltip;
  } else if (state.isTrial) {
    badge = <Badge variant="default" tone="sky" size={badgeSize}>🎁 Trial</Badge>;
    description = state.primaryTooltip;
  } else if (state.isPaid) {
    badge = <Badge variant="default" tone="green" size={badgeSize}>💰 Paid</Badge>;
    description = state.primaryTooltip;
  }

  if (!badge) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <SubscriptionTooltipBody description={description} properties={properties} />
      </TooltipContent>
    </Tooltip>
  );
}
