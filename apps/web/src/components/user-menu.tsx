"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, LogOut, User } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { api } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

export function UserMenu() {
  const { user } = useUser();
  const router = useRouter();
  const { count: unread } = useUnreadNotifications();

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() ?? "?";

  async function handleLogout() {
    try {
      await api.post("/v1/auth/logout");
    } catch {
      // Clear cookie even if request fails
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2.5 cursor-pointer outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full">
          <span className="text-sm text-muted-foreground">
            {user?.name || user?.email}
          </span>
          <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary transition-opacity hover:opacity-80">
            {initials}
            {unread > 0 && (
              <Badge
                variant="default"
                tone="red"
                size="xs"
                className="absolute -top-1 -right-1 h-4 min-w-4 px-1 tabular-nums"
                aria-label={`${unread} unread notification${unread === 1 ? "" : "s"}`}
              >
                {unread > 99 ? "99+" : unread}
              </Badge>
            )}
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            {user?.name && (
              <p className="text-sm font-medium leading-none">{user.name}</p>
            )}
            <p className="text-xs leading-none text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/notifications">
            <Bell />
            <span className="flex-1">Notifications</span>
            {unread > 0 && (
              <Badge variant="default" tone="red" size="xs" className="tabular-nums">
                {unread > 99 ? "99+" : unread}
              </Badge>
            )}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/profile">
            <User />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
