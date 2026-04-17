"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number | null | undefined;
  icon: LucideIcon;
  href?: string;
  isLoading?: boolean;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  href,
  isLoading,
}: StatCardProps) {
  const body = (
    <div className="group relative block px-5 py-5 transition-colors hover:bg-muted/40 h-full">
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
        <p className="font-semibold tabular-nums leading-none tracking-tight text-4xl">
          {value ?? "—"}
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
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
        {children}
      </div>
    </div>
  );
}
