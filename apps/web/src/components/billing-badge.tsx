"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getBillingBadgeState } from "@/lib/billing-badge";

interface BillingBadgeProps {
  properties: Record<string, string> | null | undefined;
  size?: "default" | "sm";
}

/**
 * Renders at most one subscription-state badge. Cancellation takes
 * precedence over the active Paid color so a cancelled paying user isn't
 * visually indistinguishable from an active one.
 */
export function BillingBadge({ properties, size = "default" }: BillingBadgeProps) {
  const state = getBillingBadgeState(properties);
  const cls = size === "sm" ? "text-[10px] h-5" : "text-xs";

  let badge: ReactNode = null;
  let tooltip: string | null = null;

  if (state.isCancelledTrial) {
    badge = <Badge variant="default" className={`${cls} bg-red-600`}>🎁 Trial</Badge>;
    tooltip = state.primaryTooltip;
  } else if (state.showCancelledBadge) {
    badge = <Badge variant="secondary" className={cls}>🚫 Cancelled</Badge>;
    tooltip = state.cancelledTooltip;
  } else if (state.isTrial) {
    badge = <Badge variant="default" className={`${cls} bg-sky-600`}>🎁 Trial</Badge>;
    tooltip = state.primaryTooltip;
  } else if (state.isPaid) {
    badge = <Badge variant="default" className={`${cls} bg-green-600`}>💰 Paid</Badge>;
    tooltip = state.primaryTooltip;
  }

  if (!badge) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
