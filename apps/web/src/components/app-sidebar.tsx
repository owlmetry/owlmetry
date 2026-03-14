"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderOpen },
];

export function OwlLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className}>
      <path
        d="M5 13 L3 7 L9 4 L16 3 L23 4 L29 7 L27 13 L27 24 L22 29 L16 26 L10 29 L5 24 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="currentColor"
        fillOpacity="0.1"
      />
      <circle cx="11" cy="14" r="5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.05" />
      <circle cx="11" cy="14" r="2.5" fill="currentColor" />
      <circle cx="21" cy="14" r="5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.05" />
      <circle cx="21" cy="14" r="2.5" fill="currentColor" />
      <path
        d="M14 21 L16 24.5 L18 21"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { teams } = useUser();
  const currentTeam = teams?.[0];

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center border-b px-4 gap-2.5">
        <OwlLogo className="h-6 w-6 text-primary" />
        <Link href="/" className="text-lg font-semibold tracking-tight">
          OwlMetry
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {currentTeam && (
        <div className="border-t px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground truncate">
            {currentTeam.name}
          </p>
        </div>
      )}
    </aside>
  );
}
