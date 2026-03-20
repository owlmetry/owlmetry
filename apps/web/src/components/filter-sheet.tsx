"use client";

import { useState, useCallback, useRef, type ReactNode } from "react";
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
const DISMISS_DURATION = 150;

export function FilterSheet({
  hasActiveFilters,
  onClear,
  chips,
  children,
}: FilterSheetProps) {
  const [open, setOpen] = useState(false);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const activeChips = hasActiveFilters ? chips : [];
  const visibleChips = activeChips.slice(0, MAX_VISIBLE_CHIPS);
  const overflowCount = activeChips.length - MAX_VISIBLE_CHIPS;

  const handleDismiss = useCallback((chip: FilterChip) => {
    if (!chip.onDismiss) return;
    const key = `${chip.label}:${chip.value}`;
    setDismissing((prev) => new Set(prev).add(key));
    const timer = setTimeout(() => {
      chip.onDismiss!();
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      dismissTimers.current.delete(key);
    }, DISMISS_DURATION);
    dismissTimers.current.set(key, timer);
  }, []);

  const handleClearAll = useCallback(() => {
    const keys = visibleChips.map((c) => `${c.label}:${c.value}`);
    setDismissing(new Set(keys));
    setTimeout(() => {
      onClear();
      setDismissing(new Set());
    }, DISMISS_DURATION);
  }, [visibleChips, onClear]);

  return (
    <>
      {/* Trigger row — right-aligned */}
      <div className="flex items-center justify-end gap-1.5">
        {visibleChips.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {visibleChips.map((chip) => {
              const key = `${chip.label}:${chip.value}`;
              const isDismissing = dismissing.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleDismiss(chip)}
                  disabled={isDismissing}
                  style={{
                    animation: isDismissing
                      ? `chip-out ${DISMISS_DURATION}ms ease-in forwards`
                      : "chip-in 200ms ease-out both",
                  }}
                  className="group inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 pl-2 pr-1.5 py-0.5 text-[11px] transition-colors hover:bg-muted/60 hover:border-border cursor-pointer"
                >
                  <span className="text-muted-foreground">{chip.label}:</span>
                  <span className="text-foreground/90">{chip.value}</span>
                  <X className="h-3 w-3 ml-0.5 text-muted-foreground/50 group-hover:text-foreground/70 transition-colors" />
                </button>
              );
            })}
            {overflowCount > 0 && (
              <span className="text-[10px] text-muted-foreground ml-0.5">+{overflowCount} more</span>
            )}
          </div>
        )}

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearAll}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] transition-colors hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive cursor-pointer"
          >
            <X className="h-3 w-3" />
            <span>Clear</span>
          </button>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs ml-0.5"
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
