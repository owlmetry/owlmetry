"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCardProps {
  label: string;
  value: string | number | null | undefined;
  icon: LucideIcon;
  href?: string;
  isLoading?: boolean;
  hint?: string;
}

export function StatCard({ label, value, icon: Icon, href, isLoading, hint }: StatCardProps) {
  const body = (
    <Card
      className={
        href
          ? "group cursor-pointer transition-colors hover:border-primary/40"
          : undefined
      }
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold tabular-nums">
              {value ?? "—"}
            </p>
            {hint && (
              <span className="text-xs text-muted-foreground">{hint}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}
