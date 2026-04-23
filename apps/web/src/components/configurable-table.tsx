"use client";

import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface GenericColumnDef<TRow, THelpers> {
  id: string;
  label: string;
  headerClassName?: string;
  cellClassName?: string;
  render: (row: TRow, helpers: THelpers) => ReactNode;
}

interface ConfigurableTableProps<TRow, THelpers> {
  columns: GenericColumnDef<TRow, THelpers>[];
  rows: TRow[];
  helpers: THelpers;
  rowKey: (row: TRow) => string;
  onRowClick?: (row: TRow) => void;
  isRowSelected?: (row: TRow) => boolean;
}

export function ConfigurableTable<TRow, THelpers>({
  columns,
  rows,
  helpers,
  rowKey,
  onRowClick,
  isRowSelected,
}: ConfigurableTableProps<TRow, THelpers>) {
  if (columns.length === 0) {
    return (
      <div className="rounded-md border py-12 text-center text-sm text-muted-foreground">
        No columns visible. Click the <span className="text-foreground">Columns</span> button to enable some.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.id} className={col.headerClassName}>
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const selected = isRowSelected?.(row) ?? false;
            return (
              <TableRow
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`${onRowClick ? "cursor-pointer" : ""} ${selected ? "bg-muted/50" : ""} ${onRowClick && !selected ? "hover:bg-muted/50" : ""}`}
              >
                {columns.map((col) => (
                  <TableCell key={col.id} className={col.cellClassName}>
                    {col.render(row, helpers)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
