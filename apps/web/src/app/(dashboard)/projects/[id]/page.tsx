"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Plus, Copy, Check, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";

interface App {
  id: string;
  name: string;
  platform: string;
  bundle_id: string;
  client_key: string | null;
  project_id: string;
  team_id: string;
  created_at: string;
}

interface ProjectDetail {
  id: string;
  team_id: string;
  name: string;
  slug: string;
  created_at: string;
  apps: App[];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button variant="ghost" size="icon" onClick={copy} title="Copy">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: project, mutate } = useSWR<ProjectDetail>(`/v1/projects/${id}`);

  // Edit project
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

  // Create app
  const [showCreateApp, setShowCreateApp] = useState(false);
  const [appName, setAppName] = useState("");
  const [appPlatform, setAppPlatform] = useState("ios");
  const [appBundleId, setAppBundleId] = useState("");
  const [appError, setAppError] = useState("");
  const [appLoading, setAppLoading] = useState(false);
  const [newClientKey, setNewClientKey] = useState<string | null>(null);

  // Delete
  const [deleting, setDeleting] = useState(false);

  if (!project) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.patch(`/v1/projects/${id}`, { name: editName });
      setEditing(false);
      mutate();
    } catch {
      // ignore
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this project and all its apps?")) return;
    setDeleting(true);
    try {
      await api.delete(`/v1/projects/${id}`);
      router.push("/projects");
    } catch {
      setDeleting(false);
    }
  }

  async function handleCreateApp(e: React.FormEvent) {
    e.preventDefault();
    setAppError("");
    setAppLoading(true);

    try {
      const res = await api.post<{ app: App & { client_key: string } }>("/v1/apps", {
        name: appName,
        platform: appPlatform,
        bundle_id: appBundleId,
        project_id: id,
      });
      setNewClientKey(res.app.client_key);
      setAppName("");
      setAppBundleId("");
      setShowCreateApp(false);
      mutate();
    } catch (err) {
      setAppError(err instanceof ApiError ? err.message : "Failed to create app");
    } finally {
      setAppLoading(false);
    }
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
        <Button onClick={() => setShowCreateApp(!showCreateApp)}>
          <Plus className="h-4 w-4" />
          New App
        </Button>
      </div>

      {showCreateApp && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleCreateApp} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="app-name">Name</Label>
                  <Input
                    id="app-name"
                    placeholder="My iOS App"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="app-platform">Platform</Label>
                  <select
                    id="app-platform"
                    value={appPlatform}
                    onChange={(e) => setAppPlatform(e.target.value)}
                    className="flex h-9 w-full border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="ios">iOS</option>
                    <option value="android">Android</option>
                    <option value="web">Web</option>
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
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={appLoading}>
                  {appLoading ? "Creating..." : "Create App"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowCreateApp(false)}>
                  Cancel
                </Button>
              </div>
              {appError && <p className="text-sm text-destructive">{appError}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      {project.apps.length === 0 ? (
        <p className="text-muted-foreground">No apps yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {project.apps.map((app) => (
            <AppCard key={app.id} app={app} onDeleted={mutate} />
          ))}
        </div>
      )}
    </div>
  );
}

function AppCard({ app, onDeleted }: { app: App; onDeleted: () => void }) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(app.name);
  const [deleting, setDeleting] = useState(false);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.patch(`/v1/apps/${app.id}`, { name });
      setEditingName(false);
      onDeleted();
    } catch {
      // ignore
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete app "${app.name}"?`)) return;
    setDeleting(true);
    try {
      await api.delete(`/v1/apps/${app.id}`);
      onDeleted();
    } catch {
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
        <div className="flex justify-between">
          <span className="text-muted-foreground">Platform</span>
          <span className="capitalize">{app.platform}</span>
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
