"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus, Pencil, Trash2, ScrollText, Users, RefreshCw } from "lucide-react";
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
import { api, ApiError, API_URL } from "@/lib/api";
import type { ProjectDetailResponse, AppResponse, IntegrationResponse } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";

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
      </div>

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

      <div className="pt-4">
        <h2 className="text-lg font-medium mb-4">Integrations</h2>
        <RevenueCatIntegration projectId={id} />
      </div>
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
            href={`/dashboard/apps/${app.id}`}
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

function RevenueCatIntegration({ projectId }: { projectId: string }) {
  const { data, mutate } = useSWR<{ integrations: IntegrationResponse[] }>(
    `/v1/projects/${projectId}/integrations`
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const integration = data?.integrations?.find((i) => i.provider === "revenuecat");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const config: Record<string, string> = {};
      if (apiKey) config.api_key = apiKey;
      if (webhookSecret) config.webhook_secret = webhookSecret;

      if (integration) {
        await api.patch(`/v1/projects/${projectId}/integrations/revenuecat`, { config });
      } else {
        await api.post(`/v1/projects/${projectId}/integrations`, { provider: "revenuecat", config });
      }
      setDialogOpen(false);
      setApiKey("");
      setWebhookSecret("");
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    if (!integration) return;
    setError("");
    try {
      await api.patch(`/v1/projects/${projectId}/integrations/revenuecat`, { enabled: !integration.enabled });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to toggle");
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      await api.post(`/v1/projects/${projectId}/integrations/revenuecat/sync`, {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to sync");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Remove RevenueCat integration?")) return;
    setError("");
    try {
      await api.delete(`/v1/projects/${projectId}/integrations/revenuecat`);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove");
    }
  }

  const webhookUrl = `${API_URL}/v1/webhooks/revenuecat/${projectId}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">RevenueCat</CardTitle>
          <div className="flex items-center gap-2">
            {integration && (
              <>
                <Badge variant={integration.enabled ? "default" : "secondary"} className="text-xs">
                  {integration.enabled ? "Active" : "Disabled"}
                </Badge>
                <Button variant="ghost" size="sm" onClick={handleToggle}>
                  {integration.enabled ? "Disable" : "Enable"}
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {integration ? (
          <>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">API Key</span>
                <span className="font-mono text-xs">{integration.config.api_key ?? "Not set"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Webhook Secret</span>
                <span className="font-mono text-xs">{integration.config.webhook_secret ?? "Not set"}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Webhook URL (paste into RevenueCat dashboard)</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-2 py-1.5 text-xs rounded break-all">{webhookUrl}</code>
                <CopyButton text={webhookUrl} />
              </div>
            </div>

            <div className="flex gap-2">
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Update Config
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Update RevenueCat</DialogTitle>
                    <DialogDescription>Update your RevenueCat API credentials.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleSave} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="rc-api-key">API Key (Secret)</Label>
                      <Input id="rc-api-key" type="password" placeholder="sk_..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rc-webhook-secret">Webhook Secret</Label>
                      <Input id="rc-webhook-secret" type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <DialogFooter>
                      <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || !integration.enabled}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync All Users"}
              </Button>

              <Button variant="ghost" size="sm" onClick={handleRemove}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-3">
              Connect RevenueCat to see subscription status and revenue on your users.
            </p>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Connect RevenueCat
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Connect RevenueCat</DialogTitle>
                  <DialogDescription>
                    Enter your RevenueCat API credentials. You can find these in your RevenueCat dashboard under Project Settings &gt; API Keys.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSave} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="rc-api-key-new">API Key (Secret)</Label>
                    <Input id="rc-api-key-new" type="password" placeholder="sk_..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rc-webhook-secret-new">Webhook Secret</Label>
                    <Input id="rc-webhook-secret-new" type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Optional. Used to authenticate webhook requests from RevenueCat.</p>
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <DialogFooter>
                    <Button type="submit" disabled={saving}>{saving ? "Connecting..." : "Connect"}</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
