"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { VisuallyHidden } from "radix-ui";
import { useUser } from "@/hooks/use-user";
import { NetworkError } from "@/lib/api";
import { AppSidebar, SidebarContent } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TeamProvider } from "@/contexts/team-context";
import { DataModeProvider } from "@/contexts/data-mode-context";
import { BreadcrumbProvider } from "@/contexts/breadcrumb-context";
import { Breadcrumbs } from "@/components/breadcrumbs";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading, error, mutate } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const isNetworkError = error instanceof NetworkError;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

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
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetContent side="left" className="w-56 p-0 bg-sidebar text-sidebar-foreground" showCloseButton={false}>
                <VisuallyHidden.Root><SheetTitle>Navigation</SheetTitle></VisuallyHidden.Root>
                <SidebarContent onNavigate={() => setSidebarOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="flex flex-1 flex-col min-w-0">
              <header className="flex h-14 items-center justify-between border-b px-4 md:px-6">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="md:hidden flex items-center justify-center h-10 w-10 rounded-md hover:bg-accent"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                  <Breadcrumbs />
                </div>
                <UserMenu />
              </header>
              <main className="flex-1 p-4 md:p-6">{children}</main>
            </div>
          </div>
        </div>
        </BreadcrumbProvider>
      </DataModeProvider>
    </TeamProvider>
  );
}
