"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface AttributionBadgeProps {
  properties: Record<string, string> | null | undefined;
}

const ASA_TOOLTIP_FIELDS: Array<{ key: string; label: string }> = [
  { key: "asa_campaign_id", label: "Campaign" },
  { key: "asa_ad_group_id", label: "Ad group" },
  { key: "asa_keyword_id", label: "Keyword" },
  { key: "asa_ad_id", label: "Ad" },
  { key: "asa_creative_set_id", label: "Creative" },
  { key: "asa_claim_type", label: "Claim type" },
];

/**
 * Small badge rendering the user's acquisition source. Emits a tooltip with
 * the full attribution breakdown for ASA-attributed users, and a terse
 * "Organic install" note for `attribution_source=none`. Returns null when no
 * attribution property is set (never captured / disabled / still pending).
 */
export function AttributionBadge({ properties }: AttributionBadgeProps) {
  if (!properties) return null;
  const source = properties.attribution_source;
  if (!source) return null;

  if (source === "apple_search_ads") {
    const rows = ASA_TOOLTIP_FIELDS.filter(({ key }) => properties[key]);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-xs">🎯 ASA</Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-0.5 text-xs">
            <div className="font-medium">Apple Search Ads</div>
            {rows.length === 0 ? (
              <div className="text-muted-foreground">No ad-level detail returned</div>
            ) : (
              rows.map(({ key, label }) => (
                <div key={key}>
                  <span className="text-muted-foreground">{label}:</span> {properties[key]}
                </div>
              ))
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (source === "none") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-xs">🌱 Organic</Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Organic install — Apple returned no ad attribution for this user.
        </TooltipContent>
      </Tooltip>
    );
  }

  // Future source we don't recognize — render the raw value rather than hide it.
  return <Badge variant="outline" className="text-xs">{source}</Badge>;
}
