"use client";

import { useCallback, useState } from "react";
import { useAdGroups, useAdLeaves } from "@/hooks/use-ads";
import { AdsRowTable } from "./ads-row-table";

interface CampaignAdGroupsRowProps {
  projectId: string;
  campaignId: string;
  source: string;
  appId: string | null;
}

export function CampaignAdGroupsRow({
  projectId,
  campaignId,
  source,
  appId,
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
      <div className="bg-muted/20 px-6 py-3 border-l-2 border-l-primary/20 text-xs text-muted-foreground">
        Loading ad groups…
      </div>
    );
  }

  return (
    <div className="bg-muted/20 px-6 py-3 border-l-2 border-l-primary/20">
      <AdsRowTable
        rows={adGroups}
        nameHeader="Ad group"
        variant="bare"
        emptyMessage="No ad groups with attributed users for this campaign."
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
}

function AdGroupLeavesRow({
  projectId,
  campaignId,
  adGroupId,
  source,
  appId,
}: AdGroupLeavesRowProps) {
  const { keywords, ads, isLoading } = useAdLeaves(projectId, campaignId, adGroupId, {
    attribution_source: source,
    ...(appId ? { app_id: appId } : {}),
  });

  if (isLoading) {
    return (
      <div className="bg-muted/30 px-6 py-3 border-l-2 border-l-primary/30 text-xs text-muted-foreground">
        Loading keywords and ads…
      </div>
    );
  }

  return (
    <div className="bg-muted/30 px-6 py-3 border-l-2 border-l-primary/30 space-y-3">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
          Keywords
        </div>
        <AdsRowTable
          rows={keywords}
          nameHeader="Keyword"
          variant="bare"
          emptyMessage="No keyword-attributed users in this ad group."
        />
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
          Ads
        </div>
        <AdsRowTable
          rows={ads}
          nameHeader="Ad"
          variant="bare"
          emptyMessage="No ad-attributed users in this ad group."
        />
      </div>
    </div>
  );
}
