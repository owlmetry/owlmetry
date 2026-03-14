"use client";

import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/use-user";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, error } = useUser();
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !user) {
    router.push("/login");
    return null;
  }

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b px-6">
          <UserMenu />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
