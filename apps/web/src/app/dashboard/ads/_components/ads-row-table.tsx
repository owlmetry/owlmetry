"use client";

import { Fragment, useId, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  classifyAdStatus,
  formatRoasLabel,
  roasTone,
  type AdsRow,
  type RoasTone,
} from "@owlmetry/shared/attribution";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatUsd, formatUsdCompact } from "@/lib/currency";
import { ProjectDot } from "@/lib/project-color";

type Row = AdsRow & { project_id?: string };

interface ExpandableConfig {
  isExpanded: (row: Row) => boolean;
  onToggle: (row: Row) => void;
  renderExpanded: (row: Row) => ReactNode;
}

interface AdsRowTableProps {
  rows: Row[];
  emptyMessage?: string;
  rowHref?: (row: Row) => string | null;
  expandable?: ExpandableConfig;
  /** Header label for the leftmost column (default "Name"). */
  nameHeader?: string;
  /** When provided, renders a leading "Project" column using each row's `project_id`. */
  projectInfoMap?: Map<string, { name: string; color: string }>;
  /** "card" wraps in <Card>; "bare" renders the raw table for nested rendering. */
  variant?: "card" | "bare";
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

function HeaderCell({
  label,
  tooltip,
  alignRight = false,
}: {
  label: string;
  tooltip?: string;
  alignRight?: boolean;
}) {
  const className = `px-4 py-3 font-medium${alignRight ? " text-right" : ""}`;
  if (!tooltip) return <th className={className}>{label}</th>;
  return (
    <th className={className}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted underline-offset-4">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </th>
  );
}

export function AdsRowTable({
  rows,
  emptyMessage = "No data yet.",
  rowHref,
  expandable,
  nameHeader = "Name",
  projectInfoMap,
  variant = "card",
}: AdsRowTableProps) {
  const tableId = useId();

  if (process.env.NODE_ENV !== "production" && rowHref && expandable) {
    // eslint-disable-next-line no-console
    console.warn("AdsRowTable: pass either `rowHref` or `expandable`, not both. `expandable` wins.");
  }

  if (rows.length === 0) {
    if (variant === "bare") {
      return <div className="px-4 py-3 text-xs text-muted-foreground">{emptyMessage}</div>;
    }
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
  const colCount = (showProject ? 1 : 0) + 1 + 4 + (showSpend ? 2 : 0);

  const tableEl = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {showProject && (
              <HeaderCell
                label="Project"
                tooltip="Owlmetry project the attributed users belong to."
              />
            )}
            <HeaderCell label={nameHeader} />
            <HeaderCell
              label="Users"
              alignRight
              tooltip="Total attributed users — anonymous and identified."
            />
            <HeaderCell
              label="Paying"
              alignRight
              tooltip="Users with at least one purchase recorded by the revenue source (e.g. RevenueCat)."
            />
            <HeaderCell
              label="Revenue"
              alignRight
              tooltip="Lifetime USD revenue from these attributed users."
            />
            <HeaderCell
              label="ARPU"
              alignRight
              tooltip="Average Revenue Per User — revenue ÷ total users."
            />
            {showSpend && (
              <HeaderCell
                label="Spend"
                alignRight
                tooltip="Ad spend reported by the ad network (e.g. Apple Search Ads) for this row."
              />
            )}
            {showSpend && (
              <HeaderCell
                label="ROAS"
                alignRight
                tooltip="Return On Ad Spend — revenue ÷ spend."
              />
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = !expandable && rowHref ? rowHref(row) : null;
            const display = row.name ?? row.id;
            const info = row.project_id ? projectInfoMap?.get(row.project_id) : undefined;
            const badge = classifyAdStatus(row.status);
            const roasText = formatRoasLabel(row.roas);
            const roasClass = ROAS_TONE_CLASS[roasTone(row.roas)];
            const isExpanded = expandable ? expandable.isExpanded(row) : false;
            const expandId = expandable
              ? `${tableId}-${row.project_id ?? "_"}-${row.id}`
              : undefined;
            // Suppress the parent row's bottom border when its expansion is open
            // so the data row visually groups with its expanded panel.
            const borderClass = expandable && isExpanded ? "" : "border-b last:border-b-0";
            const interactiveClass =
              href || expandable ? "relative hover:bg-muted/40 focus-within:bg-muted/40" : "";
            return (
              <Fragment key={`${row.project_id ?? "_"}:${row.id}`}>
                <tr className={`transition-colors ${borderClass} ${interactiveClass}`}>
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
                        {expandable ? (
                          // Overlay button spans the row so the whole thing toggles
                          // expansion — same UX as the Link overlay below.
                          <button
                            type="button"
                            onClick={() => expandable.onToggle(row)}
                            aria-expanded={isExpanded}
                            aria-controls={expandId}
                            className="before:absolute before:inset-0 before:content-[''] inline-flex items-center gap-1.5 text-left hover:underline"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span>{display}</span>
                          </button>
                        ) : href ? (
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
                {expandable && isExpanded && (
                  <tr id={expandId} className="border-b last:border-b-0">
                    <td colSpan={colCount} className="p-0">
                      {expandable.renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (variant === "bare") return tableEl;

  return (
    <Card>
      <CardContent className="p-0">{tableEl}</CardContent>
    </Card>
  );
}
