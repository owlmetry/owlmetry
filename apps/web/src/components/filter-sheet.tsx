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
  /** Called when the user taps the chip to dismiss this individual filter. */
  onDismiss?: () => void;
}

/** Truncate a long ID string for chip display. */
export function truncateId(value: string, max = 16): string {
  return value.length > max ? value.slice(0, max - 3) + "..." : value;
}

/** Resolve an entity ID to its name, with a truncated-ID fallback. */
export function resolveEntityName(
  entities: { id: string; name: string }[],
  id: string,
): string {
  return entities.find((e) => e.id === id)?.name ?? truncateId(id, 11);
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
              <button
                key={`${chip.label}:${chip.value}`}
                type="button"
                onClick={chip.onDismiss}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-normal transition-colors hover:bg-muted/50 cursor-pointer"
              >
                <span className="text-muted-foreground">{chip.label}:</span>
                <span>{chip.value}</span>
                <X className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            ))}
            {overflowCount > 0 && (
              <span className="text-[10px] text-muted-foreground">+{overflowCount} more</span>
            )}
          </div>
        )}

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-normal transition-colors hover:bg-muted/50 cursor-pointer"
          >
            <X className="h-2.5 w-2.5 text-muted-foreground" />
            <span>Clear</span>
          </button>
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
