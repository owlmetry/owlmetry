"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, ChevronRight, LineChart } from "lucide-react";
import {
  SPARKLINE_WINDOW_DAYS,
  resolveSparklineWindowDays,
  type SparklineWindowDays,
} from "@owlmetry/shared/preferences";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { useUser } from "@/hooks/use-user";
import {
  useUserPreferences,
  useUpdateUserPreferences,
} from "@/hooks/use-user-preferences";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { DetailSkeleton } from "@/components/ui/skeletons";
import { cn } from "@/lib/utils";

export default function ProfilePage() {
  const { user, mutate } = useUser();

  return (
    <AnimatedPage className="space-y-8">
      <StaggerItem index={0}>
        <h1 className="text-2xl font-semibold">Profile</h1>
      </StaggerItem>

      <StaggerItem index={1}>
        {!user ? (
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailSkeleton />
            </CardContent>
          </Card>
        ) : (
          <ProfileCard
            name={user.name ?? ""}
            email={user.email}
            onSaved={() => mutate()}
          />
        )}
      </StaggerItem>

      <StaggerItem index={2}>
        <DashboardPreferencesCard />
      </StaggerItem>

      <StaggerItem index={3}>
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href="/dashboard/profile/notifications"
              className="flex items-center justify-between rounded-md border p-3 hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <Bell className="size-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Notification preferences</p>
                  <p className="text-xs text-muted-foreground">
                    Choose channels (in-app, email, mobile push) for each notification type.
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      </StaggerItem>
    </AnimatedPage>
  );
}

function DashboardPreferencesCard() {
  const prefs = useUserPreferences();
  const updatePrefs = useUpdateUserPreferences();
  const current = resolveSparklineWindowDays(prefs);
  const [saving, setSaving] = useState<SparklineWindowDays | null>(null);

  async function select(window: SparklineWindowDays) {
    if (window === current) return;
    setSaving(window);
    try {
      await updatePrefs({ ui: { dashboard: { sparklineWindowDays: window } } });
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dashboard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <LineChart className="size-4 text-muted-foreground mt-0.5" />
          <div className="space-y-1 flex-1">
            <p className="text-sm font-medium">Sparkline window</p>
            <p className="text-xs text-muted-foreground">
              How many days of history to plot on the subtle trend lines under each dashboard card.
              The current UTC day is always excluded so a partial day doesn&apos;t look like a dip.
            </p>
          </div>
        </div>
        <div className="inline-flex rounded-md border bg-background p-0.5">
          {SPARKLINE_WINDOW_DAYS.map((window) => {
            const active = window === current;
            const pending = saving === window;
            return (
              <button
                key={window}
                type="button"
                onClick={() => select(window)}
                disabled={pending}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium tabular-nums rounded-[4px] transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  pending && "opacity-60",
                )}
                aria-pressed={active}
              >
                {window}d
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileCard({
  name: initialName,
  email,
  onSaved,
}: {
  name: string;
  email: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === initialName) return;
    setError("");
    setLoading(true);
    try {
      await api.patch("/v1/auth/me", { name: name.trim() });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update name");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="settings-email">Email</Label>
          <Input id="settings-email" value={email} disabled />
        </div>
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <div className="space-y-2 flex-1">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
            />
          </div>
          <Button
            type="submit"
            disabled={loading || !name.trim() || name.trim() === initialName}
          >
            {loading ? "Saving..." : "Save"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
