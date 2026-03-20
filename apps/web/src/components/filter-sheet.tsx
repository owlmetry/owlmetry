"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { SlidersHorizontal, X } from "lucide-react";

export interface FilterChip {
  label: string;
  value: string;
}

interface FilterSheetProps {
  hasActiveFilters: boolean;
  onClear: () => void;
  chips: FilterChip[];
  children: ReactNode;
}

const MAX_VISIBLE_CHIPS = 5;

export function FilterSheet({
  hasActiveFilters,
  onClear,
  chips,
  children,
}: FilterSheetProps) {
  const [open, setOpen] = useState(false);

  const activeChips = hasActiveFilters ? chips : [];
  const visibleChips = activeChips.slice(0, MAX_VISIBLE_CHIPS);
  const overflowCount = activeChips.length - MAX_VISIBLE_CHIPS;

  return (
    <>
      {/* Trigger row — right-aligned */}
      <div className="flex items-center justify-end gap-2">
        {visibleChips.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {visibleChips.map((chip) => (
              <Badge
                key={`${chip.label}:${chip.value}`}
                variant="outline"
                className="text-[10px] px-2 py-0.5 font-normal"
              >
                <span className="text-muted-foreground mr-1">{chip.label}:</span>
                {chip.value}
              </Badge>
            ))}
            {overflowCount > 0 && (
              <span className="text-[10px] text-muted-foreground">+{overflowCount} more</span>
            )}
          </div>
        )}

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClear}>
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => setOpen(true)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
          Filters
          {activeChips.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
              {activeChips.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Filter sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription className="sr-only">
              Adjust filters to narrow down results
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 space-y-4 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:w-full">
            {children}
          </div>

          {hasActiveFilters && (
            <SheetFooter>
              <Button variant="ghost" size="sm" className="text-xs w-fit" onClick={onClear}>
                <X className="h-3 w-3 mr-1" />
                Clear all filters
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
