"use client";

import { useCallback, useState } from "react";
import { useAdGroups, useAdLeaves } from "@/hooks/use-ads";
import { AdsRowTable } from "./ads-row-table";

interface CampaignAdGroupsRowProps {
  projectId: string;
  campaignId: string;
  source: string;
  appId: string | null;
  /** When the parent table shows Spend / ROAS columns, force them on here too
   * so the columns line up vertically (spreadsheet-style alignment). */
  forceShowSpend?: boolean;
}

export function CampaignAdGroupsRow({
  projectId,
  campaignId,
  source,
  appId,
  forceShowSpend,
}: CampaignAdGroupsRowProps) {
  const { adGroups, isLoading } = useAdGroups(projectId, campaignId, {
    attribution_source: source,
    ...(appId ? { app_id: appId } : {}),
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="bg-muted/20 px-4 py-3 border-l-2 border-l-primary/20 text-xs text-muted-foreground">
        Loading ad groups…
      </div>
    );
  }

  return (
    // No horizontal padding on this wrapper — the inner table fills the parent
    // row's full width so its <colgroup> widths line up with the parent table.
    // Visual nesting comes from the muted bg + 2px left accent border.
    <div className="bg-muted/20 border-l-2 border-l-primary/20">
      <AdsRowTable
        rows={adGroups}
        nameHeader="Ad group"
        variant="bare"
        emptyMessage="No ad groups with attributed users for this campaign."
        forceShowSpend={forceShowSpend}
        expandable={{
          isExpanded: (row) => expanded.has(row.id),
          onToggle: (row) => toggle(row.id),
          renderExpanded: (row) => (
            <AdGroupLeavesRow
              projectId={projectId}
              campaignId={campaignId}
              adGroupId={row.id}
              source={source}
              appId={appId}
              forceShowSpend={forceShowSpend}
            />
          ),
        }}
      />
    </div>
  );
}

interface AdGroupLeavesRowProps {
  projectId: string;
  campaignId: string;
  adGroupId: string;
  source: string;
  appId: string | null;
  forceShowSpend?: boolean;
}

function AdGroupLeavesRow({
  projectId,
  campaignId,
  adGroupId,
  source,
  appId,
  forceShowSpend,
}: AdGroupLeavesRowProps) {
  const { keywords, ads, isLoading } = useAdLeaves(projectId, campaignId, adGroupId, {
    attribution_source: source,
    ...(appId ? { app_id: appId } : {}),
  });

  if (isLoading) {
    return (
      <div className="bg-muted/30 px-4 py-3 border-l-2 border-l-primary/30 text-xs text-muted-foreground">
        Loading keywords and ads…
      </div>
    );
  }

  const showKeywords = keywords.length > 0;
  const showAds = ads.length > 0;

  if (!showKeywords && !showAds) {
    return (
      <div className="bg-muted/30 px-4 py-3 border-l-2 border-l-primary/30 text-xs text-muted-foreground">
        No keyword or ad-level breakdown for this ad group.
      </div>
    );
  }

  return (
    <div className="bg-muted/30 border-l-2 border-l-primary/30">
      {showKeywords && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-4 pt-3 pb-1">
            Keywords
          </div>
          <AdsRowTable
            rows={keywords}
            nameHeader="Keyword"
            variant="bare"
            forceShowSpend={forceShowSpend}
          />
        </div>
      )}
      {showAds && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-4 pt-3 pb-1">
            Ads
          </div>
          <AdsRowTable
            rows={ads}
            nameHeader="Ad"
            variant="bare"
            forceShowSpend={forceShowSpend}
          />
        </div>
      )}
    </div>
  );
}
