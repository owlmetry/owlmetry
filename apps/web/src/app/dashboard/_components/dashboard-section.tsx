"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface DashboardSectionProps {
  title: string;
  eyebrow?: string;
  viewAllHref?: string;
  children: React.ReactNode;
  className?: string;
}

export function DashboardSection({
  title,
  eyebrow,
  viewAllHref,
  children,
  className,
}: DashboardSectionProps) {
  return (
    <Card className={cn("overflow-hidden rounded-md", className)}>
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2.5 border-b">
        <div className="flex items-baseline gap-2">
          {eyebrow && (
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </span>
          )}
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="group flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors"
          >
            View all
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
      <div className="divide-y divide-border/60">{children}</div>
    </Card>
  );
}
