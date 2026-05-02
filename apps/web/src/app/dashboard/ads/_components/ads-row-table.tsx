"use client";

import { useRouter } from "next/navigation";
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
  const router = useRouter();

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
                return (
                  <tr
                    key={row.id}
                    className={
                      "border-b last:border-b-0 transition-colors " +
                      (href ? "cursor-pointer hover:bg-muted/40" : "")
                    }
                    onClick={href ? () => router.push(href) : undefined}
                  >
                    <td className="px-4 py-3 font-medium">
                      {row.name ?? (
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
