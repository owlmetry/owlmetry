"use client";

import { use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ATTRIBUTION_SOURCE_VALUES } from "@owlmetry/shared/attribution";
import { useAdGroups } from "@/hooks/use-ads";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { TableSkeleton } from "@/components/ui/skeletons";
import { ChevronLeft } from "lucide-react";
import { AdsRowTable } from "../_components/ads-row-table";

const DEFAULT_SOURCE = ATTRIBUTION_SOURCE_VALUES.appleSearchAds;

interface PageProps {
  params: Promise<{ campaignId: string }>;
}

export default function AdsCampaignPage({ params }: PageProps) {
  const { campaignId } = use(params);
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id") ?? "";
  const appId = searchParams.get("app_id");
  const source = searchParams.get("source") ?? DEFAULT_SOURCE;

  const { adGroups, campaignName, isLoading } = useAdGroups(
    projectId || undefined,
    campaignId,
    {
      attribution_source: source,
      ...(appId ? { app_id: appId } : {}),
    },
  );

  const backHref = `/dashboard/ads?project_id=${projectId}&source=${source}${appId ? `&app_id=${appId}` : ""}`;
  const rowHrefBuilder = (rowId: string) =>
    `/dashboard/ads/${encodeURIComponent(campaignId)}/${encodeURIComponent(rowId)}?project_id=${projectId}&source=${source}${appId ? `&app_id=${appId}` : ""}`;

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
        <Link
          href={backHref}
          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
          All campaigns
        </Link>
        <h1 className="text-2xl font-semibold mt-2">
          {campaignName ?? <span className="font-mono text-base">{campaignId}</span>}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ad groups within this campaign, ranked by revenue.
        </p>
      </StaggerItem>

      <StaggerItem index={1}>
        {isLoading ? (
          <TableSkeleton rows={5} />
        ) : !projectId ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No project context — return to <Link href="/dashboard/ads" className="underline">Ads</Link>.
            </CardContent>
          </Card>
        ) : (
          <AdsRowTable
            rows={adGroups}
            nameHeader="Ad group"
            rowHref={(row) => rowHrefBuilder(row.id)}
            emptyMessage="No ad groups with attributed users for this campaign."
          />
        )}
      </StaggerItem>
    </AnimatedPage>
  );
}
