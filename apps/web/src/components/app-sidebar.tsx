"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderOpen, ScrollText, BarChart3, KeyRound, Users, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import { OwlLogo } from "@/components/owl-logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DataMode } from "@owlmetry/shared";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/events", label: "Events", icon: ScrollText },
  { href: "/dashboard/metrics", label: "Metrics", icon: BarChart3 },
  { href: "/dashboard/api-keys", label: "API Keys", icon: KeyRound },
  { href: "/dashboard/projects", label: "Projects", icon: FolderOpen },
  { href: "/dashboard/team", label: "Team", icon: Users },
  { href: "/dashboard/audit-log", label: "Audit Log", icon: ClipboardList },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { currentTeam, teams, setCurrentTeam } = useTeam();
  const { dataMode, setDataMode } = useDataMode();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center border-b px-4 gap-2.5">
        <OwlLogo className="h-6 w-6" />
        <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
          OwlMetry
        </Link>
      </div>
      {currentTeam && (
        <div className="border-b px-4 py-2">
          {teams.length >= 2 ? (
            <Select value={currentTeam.id} onValueChange={setCurrentTeam}>
              <SelectTrigger className="h-7 text-xs font-medium text-muted-foreground border-0 px-0 shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs font-medium text-muted-foreground truncate">
              {currentTeam.name}
            </p>
          )}
        </div>
      )}
      <div className="border-b px-4 py-2">
        <ToggleGroup
          type="single"
          value={dataMode}
          onValueChange={(v) => { if (v) setDataMode(v as DataMode); }}
          className="w-full"
        >
          <ToggleGroupItem value="production" className="flex-1 text-xs h-7 px-2">
            Prod
          </ToggleGroupItem>
          <ToggleGroupItem value="debug" className="flex-1 text-xs h-7 px-2">
            Debug
          </ToggleGroupItem>
          <ToggleGroupItem value="all" className="flex-1 text-xs h-7 px-2">
            All
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
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
    </aside>
  );
}
