"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Plus, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/copy-button";
import { api, ApiError } from "@/lib/api";
import type { ProjectDetailResponse, AppResponse } from "@owlmetry/shared";

const PLATFORM_OPTIONS = [
  { value: "ios", label: "iOS" },
  { value: "ipados", label: "iPadOS" },
  { value: "macos", label: "macOS" },
  { value: "android", label: "Android" },
  { value: "web", label: "Web" },
];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: project, mutate } = useSWR<ProjectDetailResponse>(`/v1/projects/${id}`);

  // Edit project
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState("");

  // Create app
  const [appDialogOpen, setAppDialogOpen] = useState(false);
  const [appName, setAppName] = useState("");
  const [appPlatform, setAppPlatform] = useState("ios");
  const [appBundleId, setAppBundleId] = useState("");
  const [appError, setAppError] = useState("");
  const [appLoading, setAppLoading] = useState(false);
  const [newClientKey, setNewClientKey] = useState<string | null>(null);

  // Delete
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  if (!project) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    setEditError("");
    try {
      await api.patch(`/v1/projects/${id}`, { name: editName });
      setEditing(false);
      mutate();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to rename");
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this project and all its apps?")) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.delete(`/v1/projects/${id}`);
      router.push("/projects");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  async function handleCreateApp(e: React.FormEvent) {
    e.preventDefault();
    setAppError("");
    setAppLoading(true);

    try {
      const res = await api.post<{ app: AppResponse & { client_key: string } }>("/v1/apps", {
        name: appName,
        platform: appPlatform,
        bundle_id: appBundleId,
        project_id: id,
      });
      setNewClientKey(res.app.client_key);
      setAppName("");
      setAppBundleId("");
      setAppPlatform("ios");
      setAppDialogOpen(false);
      mutate();
    } catch (err) {
      setAppError(err instanceof ApiError ? err.message : "Failed to create app");
    } finally {
      setAppLoading(false);
    }
  }

  function resetAppDialog() {
    setAppName("");
    setAppBundleId("");
    setAppPlatform("ios");
    setAppError("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/projects">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>

        {editing ? (
          <form onSubmit={handleRename} className="flex items-center gap-2">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-64"
              autoFocus
            />
            <Button type="submit" size="sm">Save</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {editError && <span className="text-sm text-destructive">{editError}</span>}
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setEditName(project.name); setEditing(true); }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </div>

      {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}

      <p className="text-sm text-muted-foreground">Slug: {project.slug}</p>

      {newClientKey && (
        <Card className="border-primary">
          <CardContent className="flex items-center gap-3 pt-6">
            <p className="text-sm">
              <span className="font-medium">New app client key:</span>{" "}
              <code className="bg-muted px-1.5 py-0.5 text-xs">{newClientKey}</code>
            </p>
            <CopyButton text={newClientKey} />
            <Button variant="ghost" size="sm" onClick={() => setNewClientKey(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Apps</h2>
        <Dialog open={appDialogOpen} onOpenChange={(v) => { setAppDialogOpen(v); if (!v) resetAppDialog(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New App
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New App</DialogTitle>
              <DialogDescription>
                Add an app to {project.name}.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateApp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="app-name">Name</Label>
                <Input
                  id="app-name"
                  placeholder="My iOS App"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="app-platform">Platform</Label>
                <select
                  id="app-platform"
                  value={appPlatform}
                  onChange={(e) => setAppPlatform(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="app-bundle-id">Bundle ID</Label>
                <Input
                  id="app-bundle-id"
                  placeholder="com.example.myapp"
                  value={appBundleId}
                  onChange={(e) => setAppBundleId(e.target.value)}
                  required
                />
              </div>
              {appError && <p className="text-sm text-destructive">{appError}</p>}
              <DialogFooter>
                <Button type="submit" disabled={appLoading}>
                  {appLoading ? "Creating..." : "Create App"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {project.apps.length === 0 ? (
        <p className="text-muted-foreground">No apps yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {project.apps.map((app) => (
            <AppCard key={app.id} app={app} onChanged={mutate} />
          ))}
        </div>
      )}
    </div>
  );
}

function AppCard({ app, onChanged }: { app: AppResponse; onChanged: () => void }) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(app.name);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.patch(`/v1/apps/${app.id}`, { name });
      setEditingName(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to rename");
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete app "${app.name}"?`)) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/v1/apps/${app.id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        {editingName ? (
          <form onSubmit={handleRename} className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 text-sm"
              autoFocus
            />
            <Button type="submit" size="sm" variant="ghost">Save</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingName(false); setName(app.name); }}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{app.name}</CardTitle>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => setEditingName(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleDelete} disabled={deleting}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Platform</span>
          <span>{PLATFORM_OPTIONS.find((p) => p.value === app.platform)?.label ?? app.platform}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Bundle ID</span>
          <span className="font-mono text-xs">{app.bundle_id}</span>
        </div>
        {app.client_key && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Client Key</span>
            <div className="flex items-center gap-1">
              <code className="bg-muted px-1.5 py-0.5 text-xs">
                {app.client_key.slice(0, 20)}...
              </code>
              <CopyButton text={app.client_key} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
