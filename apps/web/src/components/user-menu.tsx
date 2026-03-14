"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function UserMenu() {
  const { user } = useUser();
  const router = useRouter();

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
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">
        {user?.name || user?.email}
      </span>
      <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign out">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
