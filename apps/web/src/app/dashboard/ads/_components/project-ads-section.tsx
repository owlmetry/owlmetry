"use client";

import type { ReactNode } from "react";
import {
  formatRoasLabel,
  roasTone,
  type AdsRow,
  type RoasTone,
  type TeamAdsRow,
} from "@owlmetry/shared/attribution";
import { ProjectDot } from "@/lib/project-color";
import { formatUsd } from "@/lib/currency";
import { AdsRowTable } from "./ads-row-table";

// Match AdsRowTable's `Row` (project_id optional) so the section's expandable
// callbacks satisfy the table's contravariant parameter types — callers pass
// in `TeamAdsRow`-typed handlers, but inside the table they're treated as the
// broader `Row`.
type SectionRow = AdsRow & { project_id?: string };

const ROAS_TONE_CLASS: Record<RoasTone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-500",
  muted: "text-muted-foreground",
};

export interface ProjectBucket {
  projectId: string;
  rows: TeamAdsRow[];
  userCount: number;
  payingUserCount: number;
  totalRevenueUsd: number;
  totalSpendUsd: number | null;
  roas: number | null;
}

// Group campaigns by project, sum metrics per bucket, then sort buckets by
// ROAS desc — buckets without usable spend (null or 0) sink to the bottom,
// ordered by revenue desc among themselves. ROAS is the only honest
// efficiency metric; revenue is the fallback because it's the only ranking
// signal that survives a missing-spend project.
export function bucketByProject(rows: TeamAdsRow[]): ProjectBucket[] {
  const map = new Map<string, ProjectBucket>();
  for (const row of rows) {
    let bucket = map.get(row.project_id);
    if (!bucket) {
      bucket = {
        projectId: row.project_id,
        rows: [],
        userCount: 0,
        payingUserCount: 0,
        totalRevenueUsd: 0,
        totalSpendUsd: null,
        roas: null,
      };
      map.set(row.project_id, bucket);
    }
    bucket.rows.push(row);
    bucket.userCount += row.user_count;
    bucket.payingUserCount += row.paying_user_count;
    bucket.totalRevenueUsd += row.total_revenue_usd;
    if (row.total_spend_usd != null) {
      bucket.totalSpendUsd = (bucket.totalSpendUsd ?? 0) + row.total_spend_usd;
    }
  }
  for (const bucket of map.values()) {
    bucket.roas =
      bucket.totalSpendUsd != null && bucket.totalSpendUsd > 0
        ? bucket.totalRevenueUsd / bucket.totalSpendUsd
        : null;
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.roas == null && b.roas == null) return b.totalRevenueUsd - a.totalRevenueUsd;
    if (a.roas == null) return 1;
    if (b.roas == null) return -1;
    if (b.roas !== a.roas) return b.roas - a.roas;
    return b.totalRevenueUsd - a.totalRevenueUsd;
  });
}

interface ProjectAdsSectionProps {
  projectName: string;
  projectColor: string | null | undefined;
  bucket: ProjectBucket;
  forceShowSpend: boolean;
  expandable: {
    isExpanded: (row: SectionRow) => boolean;
    onToggle: (row: SectionRow) => void;
    renderExpanded: (row: SectionRow) => ReactNode;
  };
}

export function ProjectAdsSection({
  projectName,
  projectColor,
  bucket,
  forceShowSpend,
  expandable,
}: ProjectAdsSectionProps) {
  const tone = roasTone(bucket.roas);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <ProjectDot color={projectColor} size={10} />
          <h2 className="text-sm font-semibold truncate">{projectName}</h2>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
          <span>
            <span className="text-foreground font-medium">{bucket.userCount.toLocaleString()}</span>{" "}
            users
          </span>
          <span>
            <span className="text-foreground font-medium">
              {bucket.payingUserCount.toLocaleString()}
            </span>{" "}
            paying
          </span>
          <span>
            <span className="text-foreground font-medium">
              {formatUsd(bucket.totalRevenueUsd)}
            </span>{" "}
            revenue
          </span>
          {bucket.totalSpendUsd != null && (
            <span>
              <span className="text-foreground font-medium">
                {formatUsd(bucket.totalSpendUsd)}
              </span>{" "}
              spend
            </span>
          )}
          {bucket.roas != null && (
            <span className={`font-medium ${ROAS_TONE_CLASS[tone]}`}>
              {formatRoasLabel(bucket.roas)} ROAS
            </span>
          )}
        </div>
      </div>
      <AdsRowTable
        rows={bucket.rows}
        nameHeader="Campaign"
        emptyMessage="No campaigns with attributed users yet."
        forceShowSpend={forceShowSpend}
        expandable={expandable}
      />
    </div>
  );
}
