"use client";

import { useUser } from "@/hooks/use-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  const { user, teams } = useUser();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Welcome, {user?.name}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Teams
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{teams?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
