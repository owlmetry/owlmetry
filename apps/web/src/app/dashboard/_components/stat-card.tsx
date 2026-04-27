"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number | null | undefined;
  secondary?: string;
  icon: LucideIcon;
  href?: string;
  isLoading?: boolean;
}

export function StatCard({
  label,
  value,
  secondary,
  icon: Icon,
  href,
  isLoading,
}: StatCardProps) {
  const body = (
    <div className="group relative block min-w-0 px-5 py-5 transition-colors hover:bg-muted/40 h-full">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <Icon
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground/70 transition-colors",
            href && "group-hover:text-primary"
          )}
        />
      </div>
      {isLoading ? (
        <Skeleton className="h-9 w-16" />
      ) : (
        <p
          className={cn(
            "font-semibold tabular-nums leading-none tracking-tight break-words",
            secondary ? "text-3xl" : "text-4xl"
          )}
        >
          {value ?? "—"}
          {secondary && (
            <span className="ml-2 text-sm font-medium text-muted-foreground">
              {secondary}
            </span>
          )}
        </p>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-card shadow-sm overflow-hidden">
      {/* 5-col grid at xl gives a clean 2 rows for the current 10-card layout
          (Issues, Events, Users, Sessions, Metrics, Funnels, Feedback, Reviews,
          Avg Rating, Projects). At smaller breakpoints the count of rows
          adjusts naturally — divides keep the visual block clean. */}
      <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-5">
        {children}
      </div>
    </div>
  );
}
