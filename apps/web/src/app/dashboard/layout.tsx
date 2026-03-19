"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUser } from "@/hooks/use-user";
import { NetworkError } from "@/lib/api";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { Button } from "@/components/ui/button";
import { TeamProvider } from "@/contexts/team-context";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/events": "Events",
  "/dashboard/api-keys": "API Keys",
  "/dashboard/projects": "Projects",
  "/dashboard/team": "Team",
  "/dashboard/audit-log": "Audit Log",
  "/dashboard/profile": "Profile",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, error, mutate } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const isNetworkError = error instanceof NetworkError;

  useEffect(() => {
    if (!isLoading && error && !isNetworkError) {
      router.push("/login");
    }
  }, [isLoading, error, isNetworkError, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (isNetworkError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4 max-w-sm">
          <h2 className="text-lg font-semibold">Unable to connect</h2>
          <p className="text-sm text-muted-foreground">
            The OwlMetry server is not reachable. Make sure it&apos;s running and try again.
          </p>
          <Button variant="outline" onClick={() => mutate()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    );
  }

  const pageTitle =
    pageTitles[pathname] ??
    (pathname.startsWith("/dashboard/projects/") ? "Project Details" : "");

  return (
    <TeamProvider>
      <div className="dark min-h-screen bg-background text-foreground">
        <div className="flex min-h-screen">
          <AppSidebar />
          <div className="flex flex-1 flex-col">
            <header className="flex h-14 items-center justify-between border-b px-6">
              <h2 className="text-sm font-medium text-muted-foreground">
                {pageTitle}
              </h2>
              <UserMenu />
            </header>
            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>
      </div>
    </TeamProvider>
  );
}
