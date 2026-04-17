"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export function EmptyState({ icon: Icon, title, subtitle, ctaLabel, ctaHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40 mb-1" />
      <p className="text-sm text-muted-foreground">{title}</p>
      {subtitle && <p className="text-xs text-muted-foreground/70">{subtitle}</p>}
      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="mt-2 text-xs font-medium text-primary hover:underline"
        >
          {ctaLabel} →
        </Link>
      )}
    </div>
  );
}
