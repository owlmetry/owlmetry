"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus, Pencil, Trash2, ScrollText, Users, Plug } from "lucide-react";
import Link from "next/link";
import { useBreadcrumbs } from "@/contexts/breadcrumb-context";
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

// Inline to avoid pulling node:crypto via the @owlmetry/shared barrel
const DEFAULT_RETENTION_DAYS_EVENTS = 120;
const DEFAULT_RETENTION_DAYS_METRICS = 365;
const DEFAULT_RETENTION_DAYS_FUNNELS = 365;

const PLATFORM_OPTIONS = [
  { value: "apple", label: "🍎 Apple" },
  { value: "android", label: "🤖 Android" },
  { value: "web", label: "🌐 Web" },
  { value: "backend", label: "☁️ Backend" },
];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { data: project, mutate } = useSWR<ProjectDetailResponse>(`/v1/projects/${id}`);

  useEffect(() => {
    if (project?.name) {
      setBreadcrumbs(
        [{ label: "Projects", href: "/dashboard/projects" }, { label: project.name }],
        pathname,
      );
    }
  }, [project?.name, pathname, setBreadcrumbs]);

  // Edit project
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState("");

  // Create app
  const [appDialogOpen, setAppDialogOpen] = useState(false);
  const [appName, setAppName] = useState("");
  const [appPlatform, setAppPlatform] = useState("apple");
  const [appBundleId, setAppBundleId] = useState("");
  const [appError, setAppError] = useState("");
  const [appLoading, setAppLoading] = useState(false);
  const [newClientSecret, setNewClientSecret] = useState<string | null>(null);

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
      router.push("/dashboard/projects");
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
      const res = await api.post<{ app: AppResponse }>("/v1/apps", {
        name: appName,
        platform: appPlatform,
        ...(appPlatform !== "backend" ? { bundle_id: appBundleId } : {}),
        project_id: id,
      });
      setNewClientSecret(res.app.client_secret);
      setAppName("");
      setAppBundleId("");
      setAppPlatform("apple");
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
    setAppPlatform("apple");
    setAppError("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
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

      <div className="flex items-center gap-4">
        <p className="text-sm text-muted-foreground">Slug: {project.slug}</p>
        <Link href={`/dashboard/events?project_id=${id}`}>
          <Button variant="outline" size="sm">
            <ScrollText className="h-3.5 w-3.5 mr-1.5" />
            View All Events
          </Button>
        </Link>
        <Link href={`/dashboard/integrations?project_id=${id}`}>
          <Button variant="outline" size="sm">
            <Plug className="h-3.5 w-3.5 mr-1.5" />
            View Integrations
          </Button>
        </Link>
      </div>

      <RetentionSettings project={project} onSaved={mutate} />

      {newClientSecret && (
        <Card className="border-primary">
          <CardContent className="flex items-center gap-3 pt-6">
            <p className="text-sm">
              <span className="font-medium">New app client secret:</span>{" "}
              <code className="bg-muted px-1.5 py-0.5 text-xs">{newClientSecret}</code>
            </p>
            <CopyButton text={newClientSecret} />
            <Button variant="ghost" size="sm" onClick={() => setNewClientSecret(null)}>
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
              {appPlatform !== "backend" && (
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
              )}
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

function RetentionSettings({ project, onSaved }: { project: ProjectDetailResponse; onSaved: () => void }) {
  const [retentionEvents, setRetentionEvents] = useState(project.retention_days_events?.toString() ?? "");
  const [retentionMetrics, setRetentionMetrics] = useState(project.retention_days_metrics?.toString() ?? "");
  const [retentionFunnels, setRetentionFunnels] = useState(project.retention_days_funnels?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Re-sync state when the project data reloads after save
  useEffect(() => {
    setRetentionEvents(project.retention_days_events?.toString() ?? "");
    setRetentionMetrics(project.retention_days_metrics?.toString() ?? "");
    setRetentionFunnels(project.retention_days_funnels?.toString() ?? "");
  }, [project.retention_days_events, project.retention_days_metrics, project.retention_days_funnels]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      await api.patch(`/v1/projects/${project.id}`, {
        retention_days_events: retentionEvents ? parseInt(retentionEvents, 10) : null,
        retention_days_metrics: retentionMetrics ? parseInt(retentionMetrics, 10) : null,
        retention_days_funnels: retentionFunnels ? parseInt(retentionFunnels, 10) : null,
      });
      setSuccess(true);
      onSaved();
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Data Retention</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="retention-events">Events (days)</Label>
              <Input
                id="retention-events"
                type="number"
                min={1}
                max={3650}
                placeholder={`${DEFAULT_RETENTION_DAYS_EVENTS} (default)`}
                value={retentionEvents}
                onChange={(e) => setRetentionEvents(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retention-metrics">Metrics (days)</Label>
              <Input
                id="retention-metrics"
                type="number"
                min={1}
                max={3650}
                placeholder={`${DEFAULT_RETENTION_DAYS_METRICS} (default)`}
                value={retentionMetrics}
                onChange={(e) => setRetentionMetrics(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retention-funnels">Funnels (days)</Label>
              <Input
                id="retention-funnels"
                type="number"
                min={1}
                max={3650}
                placeholder={`${DEFAULT_RETENTION_DAYS_FUNNELS} (default)`}
                value={retentionFunnels}
                onChange={(e) => setRetentionFunnels(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Clear a field to reset to the default. Data older than the retention period is permanently deleted daily.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving..." : "Save Retention"}
            </Button>
            {success && <span className="text-sm text-green-600">Saved</span>}
          </div>
        </form>
      </CardContent>
    </Card>
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
        {app.bundle_id && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bundle ID</span>
            <span className="font-mono text-xs">{app.bundle_id}</span>
          </div>
        )}
        {app.client_secret && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Client Secret</span>
            <div className="flex items-center gap-1">
              <code className="bg-muted px-1.5 py-0.5 text-xs">
                {app.client_secret.slice(0, 20)}...
              </code>
              <CopyButton text={app.client_secret} />
            </div>
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <Link
            href={`/dashboard/users?app_id=${app.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Users className="h-3 w-3" />
            Users
          </Link>
          <Link
            href={`/dashboard/events?app_id=${app.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ScrollText className="h-3 w-3" />
            Events
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
