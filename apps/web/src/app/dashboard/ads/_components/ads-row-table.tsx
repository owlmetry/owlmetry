"use client";

import { Fragment, useId, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
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

export const SORT_KEYS = ["users", "paying", "arpu", "spend", "revenue", "roas"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortOrder = "asc" | "desc";

// SortKey → numeric field on AdsRow. `total_spend_usd` and `roas` are nullable;
// callers should sort nulls to the bottom regardless of direction.
export const SORT_FIELD_MAP: Record<SortKey, keyof AdsRow> = {
  users: "user_count",
  paying: "paying_user_count",
  arpu: "arpu",
  spend: "total_spend_usd",
  revenue: "total_revenue_usd",
  roas: "roas",
};

interface SortConfig {
  key: SortKey;
  order: SortOrder;
  onChange: (key: SortKey) => void;
}

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
  /** Apply a left-edge accent to the #1 row to draw the eye to the revenue leader. */
  highlightTop?: boolean;
  /**
   * Force the Spend / ROAS columns on regardless of whether any row has data.
   * Nested tables pass this so their column structure matches the outer table
   * — keeps numeric columns aligned across nesting levels (the "spreadsheet
   * vibe") even when the inner level has no spend data of its own (e.g.
   * keyword-level rows in Apple Search Ads, where spend lives at the ad-group
   * level).
   */
  forceShowSpend?: boolean;
  /**
   * When provided, numeric column headers become click-to-sort buttons.
   * Sorting itself happens in the caller (this component just renders the
   * indicator and fires `onChange`). Omit on nested tables to keep them
   * static.
   */
  sort?: SortConfig;
}

// Column widths for the right-aligned numeric columns. Identical at every
// nesting level so the columns line up vertically across parent + nested
// tables (table-layout: fixed honors these strictly, regardless of content
// width). The name column is auto-sized — it gets whatever's left over,
// which is fine because each level has its own name (CAMPAIGN / AD GROUP /
// KEYWORD / AD).
const COL_W = {
  project: 200,
  users: 100,
  paying: 100,
  revenue: 140,
  arpu: 100,
  spend: 140,
  roas: 100,
} as const;

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

// Soft-style "names" that are clearly raw Apple IDs leaking through name
// resolution — Apple campaign / ad-group / keyword / ad IDs are 8+ digit
// integers. Don't false-positive on real human-set names that happen to
// match the row ID in test fixtures.
function isUnresolvedName(row: Row): boolean {
  if (!row.name) return true;
  return /^\d{8,}$/.test(row.name);
}

function HeaderCell({
  label,
  tooltip,
  alignRight = false,
  sortKey,
  sort,
}: {
  label: string;
  tooltip?: string;
  alignRight?: boolean;
  sortKey?: SortKey;
  sort?: SortConfig;
}) {
  const className = `px-4 py-3 font-medium${alignRight ? " text-right" : ""}`;
  const sortable = !!(sortKey && sort);
  const isActive = sortable && sort!.key === sortKey;
  const Indicator = isActive ? (sort!.order === "asc" ? ChevronUp : ChevronDown) : null;
  const inlineWrapper = alignRight ? "inline-flex items-center justify-end gap-1" : "inline-flex items-center gap-1";

  // Three header flavors: sortable button (always wins when sortKey+sort given),
  // tooltipped span (current behavior for non-sortable), plain text otherwise.
  let trigger: ReactNode;
  if (sortable) {
    trigger = (
      <button
        type="button"
        onClick={() => sort!.onChange(sortKey!)}
        className={`${inlineWrapper} cursor-pointer transition-colors hover:text-foreground ${
          isActive ? "text-foreground" : ""
        }`}
      >
        {label}
        {Indicator && <Indicator className="h-3 w-3" aria-hidden="true" />}
      </button>
    );
  } else if (tooltip) {
    trigger = (
      <span className="cursor-help underline decoration-dotted underline-offset-4">{label}</span>
    );
  } else {
    return <th className={className}>{label}</th>;
  }

  if (!tooltip) {
    return (
      <th className={className} aria-sort={isActive ? (sort!.order === "asc" ? "ascending" : "descending") : undefined}>
        {trigger}
      </th>
    );
  }
  return (
    <th className={className} aria-sort={isActive ? (sort!.order === "asc" ? "ascending" : "descending") : undefined}>
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
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
  highlightTop = false,
  forceShowSpend,
  sort,
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
  // `forceShowSpend` overrides this so nested tables stay column-aligned
  // with their parent.
  const showSpend = forceShowSpend ?? rows.some((r) => r.total_spend_usd != null);
  const colCount = (showProject ? 1 : 0) + 1 + 4 + (showSpend ? 2 : 0);

  const tableEl = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm table-fixed">
        <colgroup>
          {showProject && <col style={{ width: COL_W.project }} />}
          {/* name column — flexes into remaining space so long campaign /
              ad-group / keyword names get the breathing room they need */}
          <col />
          <col style={{ width: COL_W.users }} />
          <col style={{ width: COL_W.paying }} />
          <col style={{ width: COL_W.arpu }} />
          {showSpend && <col style={{ width: COL_W.spend }} />}
          <col style={{ width: COL_W.revenue }} />
          {showSpend && <col style={{ width: COL_W.roas }} />}
        </colgroup>
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
              sortKey="users"
              sort={sort}
            />
            <HeaderCell
              label="Paying"
              alignRight
              tooltip="Users with at least one purchase recorded by the revenue source (e.g. RevenueCat)."
              sortKey="paying"
              sort={sort}
            />
            <HeaderCell
              label="ARPU"
              alignRight
              tooltip="Average Revenue Per User — revenue ÷ total users."
              sortKey="arpu"
              sort={sort}
            />
            {showSpend && (
              <HeaderCell
                label="Spend"
                alignRight
                tooltip="Ad spend reported by the ad network (e.g. Apple Search Ads) for this row."
                sortKey="spend"
                sort={sort}
              />
            )}
            <HeaderCell
              label="Revenue"
              alignRight
              tooltip="Lifetime USD revenue from these attributed users."
              sortKey="revenue"
              sort={sort}
            />
            {showSpend && (
              <HeaderCell
                label="ROAS"
                alignRight
                tooltip="Return On Ad Spend — revenue ÷ spend."
                sortKey="roas"
                sort={sort}
              />
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const href = !expandable && rowHref ? rowHref(row) : null;
            const unresolved = isUnresolvedName(row);
            const display = row.name ?? row.id;
            const info = row.project_id ? projectInfoMap?.get(row.project_id) : undefined;
            const badge = classifyAdStatus(row.status);
            const roasText = formatRoasLabel(row.roas);
            const roasClass = ROAS_TONE_CLASS[roasTone(row.roas)];
            const isExpanded = expandable ? expandable.isExpanded(row) : false;
            const expandId = expandable
              ? `${tableId}-${row.project_id ?? "_"}-${row.id}`
              : undefined;
            // Top-row accent: emerald when the leader is also ROAS-positive,
            // amber otherwise (still the leader, but no spend signal yet).
            // Inset box-shadow because <tr> borders render unreliably across
            // browsers under the table's collapsed border model.
            const isTop = highlightTop && index === 0;
            const topShadowStyle = isTop
              ? {
                  boxShadow:
                    roasTone(row.roas) === "good"
                      ? "inset 3px 0 0 0 rgb(16 185 129)"
                      : "inset 3px 0 0 0 rgb(245 158 11)",
                }
              : undefined;
            // Suppress the parent row's bottom border when its expansion is open
            // so the data row visually groups with its expanded panel.
            const borderClass = expandable && isExpanded ? "" : "border-b last:border-b-0";
            const interactiveClass =
              href || expandable ? "relative hover:bg-muted/40 focus-within:bg-muted/40" : "";
            // Subtle leader treatment: same row, slightly warmer background.
            const topBgClass = isTop ? "bg-amber-500/[0.03] dark:bg-amber-400/[0.04]" : "";
            const nameClasses = unresolved
              ? "font-mono text-xs italic text-muted-foreground"
              : "";
            return (
              <Fragment key={`${row.project_id ?? "_"}:${row.id}`}>
                <tr
                  className={`group transition-colors ${borderClass} ${interactiveClass} ${topBgClass}`}
                  style={topShadowStyle}
                >
                  {showProject && (
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <ProjectDot color={info?.color ?? null} />
                        <span className="truncate">{info?.name ?? "—"}</span>
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium overflow-hidden">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {expandable ? (
                          // Overlay button spans the row so the whole thing toggles
                          // expansion — same UX as the Link overlay below.
                          <button
                            type="button"
                            onClick={() => expandable.onToggle(row)}
                            aria-expanded={isExpanded}
                            aria-controls={expandId}
                            className="before:absolute before:inset-0 before:content-[''] inline-flex items-center gap-2 text-left hover:underline min-w-0"
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 shrink-0 text-foreground/60 transition-transform duration-150 group-hover:text-foreground ${
                                isExpanded ? "rotate-90" : ""
                              }`}
                            />
                            <span className={`truncate ${nameClasses}`}>{display}</span>
                            {unresolved && (
                              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-normal not-italic">
                                unnamed
                              </span>
                            )}
                          </button>
                        ) : href ? (
                          // Overlay link spans the row so the whole thing is clickable
                          // for mouse users while keyboard + screen readers see a real
                          // <a> with the campaign/ad-group name as accessible text.
                          <Link
                            href={href}
                            className="before:absolute before:inset-0 before:content-[''] inline-flex items-center gap-2 hover:underline min-w-0"
                          >
                            <span className={`truncate ${nameClasses}`}>{display}</span>
                            {unresolved && (
                              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-normal not-italic">
                                unnamed
                              </span>
                            )}
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <span className={`truncate ${nameClasses}`}>{display}</span>
                            {unresolved && (
                              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-normal not-italic">
                                unnamed
                              </span>
                            )}
                          </span>
                        )}
                        {badge && (
                          <span
                            className={
                              "relative z-10 shrink-0 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide " +
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
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-medium ${
                      isTop ? "text-foreground" : ""
                    }`}
                  >
                    {formatUsd(row.total_revenue_usd)}
                  </td>
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
