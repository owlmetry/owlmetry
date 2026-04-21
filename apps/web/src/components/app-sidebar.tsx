"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderOpen, ScrollText, BarChart3, Filter, KeyRound, Users, UserSearch, ClipboardList, Cog, BookOpen, Plug, Bug, MessageSquare } from "lucide-react";
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
  { href: "/dashboard/issues", label: "Issues", icon: Bug },
  { href: "/dashboard/feedback", label: "Feedback", icon: MessageSquare },
  { href: "/dashboard/users", label: "Users", icon: UserSearch },
  { href: "/dashboard/metrics", label: "Metrics", icon: BarChart3 },
  { href: "/dashboard/funnels", label: "Funnels", icon: Filter },
  { href: "/dashboard/api-keys", label: "API Keys", icon: KeyRound },
  { href: "/dashboard/projects", label: "Projects", icon: FolderOpen },
  { href: "/dashboard/integrations", label: "Integrations", icon: Plug },
  { href: "/dashboard/team", label: "Team", icon: Users },
  { href: "/dashboard/audit-log", label: "Audit Log", icon: ClipboardList },
  { href: "/dashboard/jobs", label: "Jobs", icon: Cog },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { currentTeam, teams, setCurrentTeam } = useTeam();
  const { dataMode, setDataMode } = useDataMode();

  return (
    <>
      <div className="flex h-14 items-center border-b px-4 gap-2.5">
        <OwlLogo className="h-6 w-6" />
        <Link href="/" className="text-lg font-semibold tracking-tight">
          OwlMetry
        </Link>
      </div>
      {currentTeam && (
        <div className="border-b px-3 py-2">
          {teams.length >= 2 ? (
            <Select value={currentTeam.id} onValueChange={setCurrentTeam}>
              <SelectTrigger className="h-8 w-full text-xs font-medium text-muted-foreground bg-sidebar-accent/50 border-sidebar-border shadow-none focus:ring-0">
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
            <div className="flex h-8 w-full items-center rounded-md bg-sidebar-accent/50 border border-sidebar-border px-3">
              <p className="text-xs font-medium text-muted-foreground truncate">
                {currentTeam.name}
              </p>
            </div>
          )}
        </div>
      )}
      <div className="border-b px-3 py-2">
        <ToggleGroup
          type="single"
          value={dataMode}
          onValueChange={(v) => { if (v) setDataMode(v as DataMode); }}
          className="w-full bg-background/40 rounded-md p-0.5"
        >
          <ToggleGroupItem value="production" className="flex-1 text-xs h-7 px-2 data-[state=on]:bg-primary/15 data-[state=on]:text-primary">
            Prod
          </ToggleGroupItem>
          <ToggleGroupItem value="development" className="flex-1 text-xs h-7 px-2 data-[state=on]:bg-primary/15 data-[state=on]:text-primary">
            Dev
          </ToggleGroupItem>
          <ToggleGroupItem value="all" className="flex-1 text-xs h-7 px-2 data-[state=on]:bg-primary/15 data-[state=on]:text-primary">
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
              onClick={onNavigate}
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
    </>
  );
}

export function AppSidebar() {
  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <SidebarContent />
    </aside>
  );
}
