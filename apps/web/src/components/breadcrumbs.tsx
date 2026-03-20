"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useBreadcrumbs } from "@/contexts/breadcrumb-context";

const FALLBACK_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/events": "Events",
  "/dashboard/funnels": "Funnels",
  "/dashboard/metrics": "Metrics",
  "/dashboard/api-keys": "API Keys",
  "/dashboard/projects": "Projects",
  "/dashboard/team": "Team",
  "/dashboard/audit-log": "Audit Log",
  "/dashboard/profile": "Profile",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const { breadcrumbs, breadcrumbPath } = useBreadcrumbs();

  if (breadcrumbPath === pathname && breadcrumbs.length > 0) {
    return (
      <nav className="flex items-center gap-1.5 text-sm">
        {breadcrumbs.map((item, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              {isLast || !item.href ? (
                <span className={isLast ? "font-medium text-foreground" : "text-muted-foreground"}>
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {item.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
    );
  }

  const title = FALLBACK_TITLES[pathname] ?? "";

  if (!title) return null;

  return (
    <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
  );
}
