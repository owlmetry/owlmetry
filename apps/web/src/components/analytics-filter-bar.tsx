"use client";

import type { ReactNode } from "react";
import type { UrlFilters } from "@/hooks/use-url-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import { TIME_RANGES, ENVIRONMENTS } from "@/lib/time-ranges";

export interface GroupByOption {
  value: string;
  label: string;
}

interface AnalyticsFilterBarProps {
  filters: UrlFilters;
  /** Group-by options. If omitted, group-by selector is hidden. */
  groupByOptions?: GroupByOption[];
  /** Whether the group-by select uses "" as the "none" value (default: false, uses first option as default). */
  groupByAllowNone?: boolean;
  /** Extra controls rendered before the standard filters. */
  leadingChildren?: ReactNode;
  /** Extra controls rendered after the standard filters (before the Clear button). */
  children?: ReactNode;
}

export function AnalyticsFilterBar({
  filters,
  groupByOptions,
  groupByAllowNone,
  leadingChildren,
  children,
}: AnalyticsFilterBarProps) {
  const timeRange = filters.get("time_range");
  const sinceInput = filters.get("since");
  const untilInput = filters.get("until");
  const appVersion = filters.get("app_version");
  const environment = filters.get("environment");
  const groupBy = filters.get("group_by");

  return (
    <div className="flex items-end gap-3 flex-wrap">
      {leadingChildren}

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Time Range</label>
        <Select value={timeRange} onValueChange={filters.handleTimeRangeChange}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Since</label>
        <Input
          type="date"
          value={sinceInput}
          onChange={(e) => filters.handleDateChange("since", e.target.value)}
          className="w-[160px] h-8 text-xs"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Until</label>
        <Input
          type="date"
          value={untilInput}
          onChange={(e) => filters.handleDateChange("until", e.target.value)}
          className="w-[160px] h-8 text-xs"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">App Version</label>
        <Input
          type="text"
          placeholder="e.g. 1.0.0"
          value={appVersion}
          onChange={(e) => filters.set("app_version", e.target.value)}
          className="w-[160px] h-8 text-xs"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Environment</label>
        <Select
          value={environment || "all"}
          onValueChange={(v) => filters.set("environment", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {ENVIRONMENTS.map((env) => (
              <SelectItem key={env} value={env}>
                {env}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {groupByOptions && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Group By</label>
          <Select
            value={groupBy || (groupByAllowNone ? "none" : groupByOptions[0]?.value ?? "")}
            onValueChange={(v) =>
              filters.set("group_by", groupByAllowNone && v === "none" ? "" : v)
            }
          >
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groupByAllowNone && <SelectItem value="none">None</SelectItem>}
              {groupByOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {children}

      {filters.hasActiveFilters && (
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={filters.clearFilters}>
          <X className="h-3 w-3 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
