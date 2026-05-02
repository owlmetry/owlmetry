"use client";

import Link from "next/link";
import {
  classifyAdStatus,
  formatRoasLabel,
  roasTone,
  type AdsRow,
  type RoasTone,
} from "@owlmetry/shared/attribution";
import { Card, CardContent } from "@/components/ui/card";
import { formatUsd, formatUsdCompact } from "@/lib/currency";
import { ProjectDot } from "@/lib/project-color";

type Row = AdsRow & { project_id?: string };

interface AdsRowTableProps {
  rows: Row[];
  emptyMessage?: string;
  rowHref?: (row: Row) => string | null;
  /** Header label for the leftmost column (default "Name"). */
  nameHeader?: string;
  /** When provided, renders a leading "Project" column using each row's `project_id`. */
  projectInfoMap?: Map<string, { name: string; color: string }>;
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function formatStartDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return SHORT_DATE.format(d);
}

const ROAS_TONE_CLASS: Record<RoasTone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-500",
  muted: "text-muted-foreground",
};

const STATUS_TONE_CLASS = {
  warn: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  bad: "border-red-500/40 text-red-700 dark:text-red-400",
  muted: "border-muted-foreground/30 text-muted-foreground",
} as const;

export function AdsRowTable({
  rows,
  emptyMessage = "No data yet.",
  rowHref,
  nameHeader = "Name",
  projectInfoMap,
}: AdsRowTableProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">{emptyMessage}</CardContent>
      </Card>
    );
  }

  const showProject = !!projectInfoMap;
  // Hide spend/ROAS columns entirely when no row reported them — keeps a
  // pre-integration project's table dense rather than full of em-dashes.
  const showSpend = rows.some((r) => r.total_spend_usd != null);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {showProject && <th className="px-4 py-3 font-medium">Project</th>}
                <th className="px-4 py-3 font-medium">{nameHeader}</th>
                <th className="px-4 py-3 font-medium text-right">Users</th>
                <th className="px-4 py-3 font-medium text-right">Paying</th>
                <th className="px-4 py-3 font-medium text-right">Revenue</th>
                <th className="px-4 py-3 font-medium text-right">ARPU</th>
                {showSpend && <th className="px-4 py-3 font-medium text-right">Spend</th>}
                {showSpend && <th className="px-4 py-3 font-medium text-right">ROAS</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = rowHref ? rowHref(row) : null;
                const display = row.name ?? row.id;
                const info = row.project_id ? projectInfoMap?.get(row.project_id) : undefined;
                const badge = classifyAdStatus(row.status);
                const roasText = formatRoasLabel(row.roas);
                const roasClass = ROAS_TONE_CLASS[roasTone(row.roas)];
                return (
                  <tr
                    key={`${row.project_id ?? "_"}:${row.id}`}
                    className={
                      "border-b last:border-b-0 transition-colors " +
                      (href ? "relative hover:bg-muted/40 focus-within:bg-muted/40" : "")
                    }
                  >
                    {showProject && (
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-2">
                          <ProjectDot color={info?.color ?? null} />
                          <span className="truncate">{info?.name ?? "—"}</span>
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          {href ? (
                            // Overlay link spans the row so the whole thing is clickable
                            // for mouse users while keyboard + screen readers see a real
                            // <a> with the campaign/ad-group name as accessible text.
                            <Link
                              href={href}
                              className="before:absolute before:inset-0 before:content-[''] hover:underline"
                            >
                              {display}
                            </Link>
                          ) : row.name ? (
                            display
                          ) : (
                            <span className="text-muted-foreground font-mono text-xs">{row.id}</span>
                          )}
                          {badge && (
                            <span
                              className={
                                "relative z-10 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide " +
                                STATUS_TONE_CLASS[badge.tone]
                              }
                            >
                              {badge.label}
                            </span>
                          )}
                        </div>
                        {row.start_date && (
                          <span className="text-xs text-muted-foreground">
                            Started {formatStartDate(row.start_date)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.user_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.paying_user_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {formatUsd(row.total_revenue_usd)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {formatUsdCompact(row.arpu)}
                    </td>
                    {showSpend && (
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.total_spend_usd == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatUsd(row.total_spend_usd)
                        )}
                      </td>
                    )}
                    {showSpend && (
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${roasClass}`}>
                        {roasText}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
