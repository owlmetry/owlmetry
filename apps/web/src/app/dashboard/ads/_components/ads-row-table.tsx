"use client";

import Link from "next/link";
import type { AdsRow } from "@owlmetry/shared/attribution";
import { Card, CardContent } from "@/components/ui/card";
import { formatUsd, formatUsdCompact } from "@/lib/currency";

interface AdsRowTableProps {
  rows: AdsRow[];
  emptyMessage?: string;
  rowHref?: (row: AdsRow) => string | null;
  /** Header label for the leftmost column (default "Name"). */
  nameHeader?: string;
}

export function AdsRowTable({
  rows,
  emptyMessage = "No data yet.",
  rowHref,
  nameHeader = "Name",
}: AdsRowTableProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">{emptyMessage}</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{nameHeader}</th>
                <th className="px-4 py-3 font-medium text-right">Users</th>
                <th className="px-4 py-3 font-medium text-right">Paying</th>
                <th className="px-4 py-3 font-medium text-right">Revenue</th>
                <th className="px-4 py-3 font-medium text-right">ARPU</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = rowHref ? rowHref(row) : null;
                const display = row.name ?? row.id;
                return (
                  <tr
                    key={row.id}
                    className={
                      "border-b last:border-b-0 transition-colors " +
                      (href ? "relative hover:bg-muted/40 focus-within:bg-muted/40" : "")
                    }
                  >
                    <td className="px-4 py-3 font-medium">
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
