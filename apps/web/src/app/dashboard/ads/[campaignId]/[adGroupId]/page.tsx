"use client";

import { use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ATTRIBUTION_SOURCE_VALUES } from "@owlmetry/shared/attribution";
import { useAdLeaves } from "@/hooks/use-ads";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { TableSkeleton } from "@/components/ui/skeletons";
import { ChevronLeft } from "lucide-react";
import { AdsRowTable } from "../../_components/ads-row-table";

const DEFAULT_SOURCE = ATTRIBUTION_SOURCE_VALUES.appleSearchAds;

interface PageProps {
  params: Promise<{ campaignId: string; adGroupId: string }>;
}

export default function AdsAdGroupPage({ params }: PageProps) {
  const { campaignId, adGroupId } = use(params);
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id") ?? "";
  const appId = searchParams.get("app_id");
  const source = searchParams.get("source") ?? DEFAULT_SOURCE;

  const { keywords, ads, campaignName, adGroupName, isLoading } = useAdLeaves(
    projectId || undefined,
    campaignId,
    adGroupId,
    {
      attribution_source: source,
      ...(appId ? { app_id: appId } : {}),
    },
  );

  const backHref = `/dashboard/ads/${encodeURIComponent(campaignId)}?project_id=${projectId}&source=${source}${appId ? `&app_id=${appId}` : ""}`;

  function renderBody() {
    if (isLoading) return <TableSkeleton rows={5} />;
    if (!projectId) {
      return (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No project context — return to <Link href="/dashboard/ads" className="underline">Ads</Link>.
          </CardContent>
        </Card>
      );
    }
    return (
      <>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Keywords</h2>
        <AdsRowTable
          rows={keywords}
          nameHeader="Keyword"
          emptyMessage="No keyword-attributed users in this ad group."
        />
        <h2 className="text-sm font-medium text-muted-foreground mb-2 mt-4">Ads</h2>
        <AdsRowTable
          rows={ads}
          nameHeader="Ad"
          emptyMessage="No ad-attributed users in this ad group."
        />
      </>
    );
  }

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
        <Link
          href={backHref}
          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
          {campaignName ?? "Campaign"}
        </Link>
        <h1 className="text-2xl font-semibold mt-2">
          {adGroupName ?? <span className="font-mono text-base">{adGroupId}</span>}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Keywords and ads within this ad group, ranked by revenue. Apple Search Ads
          attributes a user to one or the other depending on whether the install came
          from a search keyword or an auto-driven ad placement.
        </p>
      </StaggerItem>

      <StaggerItem index={1}>{renderBody()}</StaggerItem>
    </AnimatedPage>
  );
}
