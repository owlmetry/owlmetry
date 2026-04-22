import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeaderSkeleton({
  hasSubtitle = true,
  hasAction = false,
  className,
}: {
  hasSubtitle?: boolean;
  hasAction?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4",
        className,
      )}
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        {hasSubtitle && <Skeleton className="h-4 w-72" />}
      </div>
      {hasAction && <Skeleton className="h-9 w-28" />}
    </div>
  );
}

export function ListSkeleton({
  rows = 6,
  showAvatar = false,
  showTrailing = true,
  className,
}: {
  rows?: number;
  showAvatar?: boolean;
  showTrailing?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border divide-y", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          {showAvatar && <Skeleton className="h-8 w-8 rounded-full" />}
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          {showTrailing && <Skeleton className="h-3 w-10" />}
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({
  rows = 8,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border overflow-hidden", className)}>
      <div className="flex items-center gap-4 border-b bg-muted/30 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn(
              "h-3",
              i === 0 ? "w-32" : i === columns - 1 ? "w-16 ml-auto" : "w-24",
            )}
          />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton
                key={c}
                className={cn(
                  "h-3",
                  c === 0
                    ? "w-32"
                    : c === columns - 1
                      ? "w-16 ml-auto"
                      : "w-24",
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardGridSkeleton({
  cards = 6,
  className,
}: {
  cards?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border bg-card p-5 space-y-3"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <div className="flex items-center justify-between pt-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("space-y-4 py-1", className)}>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
      <div className="flex items-center gap-2 pt-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
}

export function KanbanSkeleton({
  columns = 4,
  cardsPerColumn = 3,
  className,
}: {
  columns?: number;
  cardsPerColumn?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 3
          ? "grid-cols-1 md:grid-cols-3"
          : columns === 5
            ? "grid-cols-1 md:grid-cols-3 xl:grid-cols-5"
            : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {Array.from({ length: columns }).map((_, col) => (
        <div
          key={col}
          className="rounded-md border bg-muted/20 p-3 space-y-3"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-6" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: cardsPerColumn }).map((_, i) => (
              <div
                key={i}
                className="rounded-md border bg-card p-3 space-y-2"
              >
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-1/2" />
                <div className="flex items-center gap-2 pt-1">
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="h-3 w-12" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
