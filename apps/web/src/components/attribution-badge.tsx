"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface AttributionBadgeProps {
  properties: Record<string, string> | null | undefined;
}

// Ordered list of known ASA keys with human-readable labels. Any asa_* key
// not in this list is still shown in the tooltip with a humanized fallback
// label so future additions surface automatically.
const ASA_LABELS: Array<[key: string, label: string]> = [
  ["asa_campaign_name", "Campaign"],
  ["asa_campaign_id", "Campaign ID"],
  ["asa_ad_group_name", "Ad group"],
  ["asa_ad_group_id", "Ad group ID"],
  ["asa_keyword", "Keyword"],
  ["asa_keyword_id", "Keyword ID"],
  ["asa_ad_name", "Ad"],
  ["asa_ad_id", "Ad ID"],
  ["asa_creative_set_id", "Creative"],
  ["asa_claim_type", "Claim type"],
];

function humanizeAsaKey(key: string): string {
  const stripped = key.startsWith("asa_") ? key.slice(4) : key;
  const words = stripped.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function orderedAsaEntries(properties: Record<string, string>): Array<[string, string]> {
  const ordered: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const [key] of ASA_LABELS) {
    const v = properties[key];
    if (v) {
      ordered.push([key, v]);
      seen.add(key);
    }
  }
  // Surface any future asa_* keys we don't yet have a curated label for.
  for (const [k, v] of Object.entries(properties)) {
    if (k.startsWith("asa_") && !seen.has(k) && v) ordered.push([k, v]);
  }
  return ordered;
}

function labelFor(key: string): string {
  const known = ASA_LABELS.find(([k]) => k === key);
  return known ? known[1] : humanizeAsaKey(key);
}

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
    const rows = orderedAsaEntries(properties);
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
              rows.map(([key, value]) => (
                <div key={key}>
                  <span className="text-muted-foreground">{labelFor(key)}:</span> {value}
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
  return <Badge variant="outline" className="text-xs">🏷️ {source}</Badge>;
}
