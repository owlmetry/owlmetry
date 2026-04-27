"use client";

import { useState } from "react";
import useSWR from "swr";
import type { AppRatingsResponse } from "@owlmetry/shared";
import { countryName, countryFlag } from "@owlmetry/shared/app-store-countries";
import { ChevronDown, ChevronRight, Star } from "lucide-react";

interface RatingByCountryGridProps {
  projectId: string;
  appId: string;
  // Show this many rows by default; rest hidden behind "show all" toggle.
  initialCount?: number;
}

// Per-app per-country rating breakdown. Lazy-loads on first expand to avoid
// firing a query per app card for every project view.
export function RatingByCountryGrid({ projectId, appId, initialCount = 12 }: RatingByCountryGridProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { data } = useSWR<AppRatingsResponse>(
    expanded ? `/v1/projects/${projectId}/apps/${appId}/ratings` : null,
  );

  const rows = data?.ratings ?? [];
  const visible = showAll ? rows : rows.slice(0, initialCount);

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Ratings by country
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {data === undefined ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No ratings synced yet for this app. The daily sync runs at 04:30 UTC, or hit the
              manual sync button to populate now.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {visible.map((r) => (
                  <div
                    key={r.country_code}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-border bg-muted/30"
                  >
                    <span className="text-xs text-muted-foreground truncate" title={countryName(r.country_code)}>
                      {countryFlag(r.country_code)} {r.country_code.toUpperCase()}
                    </span>
                    <span className="text-xs tabular-nums whitespace-nowrap">
                      {r.average_rating !== null ? r.average_rating.toFixed(2) : "—"}{" "}
                      <Star className="inline h-3 w-3 fill-amber-400 text-amber-400 align-text-bottom" />{" "}
                      <span className="text-muted-foreground">({r.rating_count.toLocaleString()})</span>
                    </span>
                  </div>
                ))}
              </div>
              {rows.length > initialCount && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showAll ? "Show fewer" : `Show all ${rows.length}`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
