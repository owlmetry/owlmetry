"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { useUser } from "@/hooks/use-user";

export default function ProfilePage() {
  const { user, mutate } = useUser();

  if (!user) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <ProfileCard
        name={user.name ?? ""}
        email={user.email}
        onSaved={() => mutate()}
      />
    </div>
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
