"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";

interface DashboardSectionProps {
  title: string;
  viewAllHref?: string;
  children: React.ReactNode;
}

export function DashboardSection({ title, viewAllHref, children }: DashboardSectionProps) {
  return (
    <Card className="overflow-hidden rounded-md">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">{title}</h3>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View all
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
      <div className="divide-y">{children}</div>
    </Card>
  );
}
