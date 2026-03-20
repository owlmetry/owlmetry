"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/use-user";
import { NetworkError } from "@/lib/api";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { Button } from "@/components/ui/button";
import { TeamProvider } from "@/contexts/team-context";
import { DataModeProvider } from "@/contexts/data-mode-context";
import { BreadcrumbProvider } from "@/contexts/breadcrumb-context";
import { Breadcrumbs } from "@/components/breadcrumbs";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, error, mutate } = useUser();
  const router = useRouter();
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

  return (
    <TeamProvider>
      <DataModeProvider>
        <BreadcrumbProvider>
        <div className="dark min-h-screen bg-background text-foreground">
          <div className="flex min-h-screen">
            <AppSidebar />
            <div className="flex flex-1 flex-col">
              <header className="flex h-14 items-center justify-between border-b px-6">
                <Breadcrumbs />
                <UserMenu />
              </header>
              <main className="flex-1 p-6">{children}</main>
            </div>
          </div>
        </div>
        </BreadcrumbProvider>
      </DataModeProvider>
    </TeamProvider>
  );
}
