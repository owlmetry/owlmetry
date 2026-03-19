"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft, Search, Users, KeyRound, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/copy-button";
import { useAppUsers } from "@/hooks/use-app-users";
import { useApiKeys } from "@/hooks/use-api-keys";
import { api, ApiError } from "@/lib/api";
import type {
  AppResponse,
  AppUsersQueryParams,
  ApiKeyResponse,
  CreateApiKeyResponse,
  GetApiKeyResponse,
  DeleteApiKeyResponse,
} from "@owlmetry/shared";
import {
  ALLOWED_PERMISSIONS_BY_KEY_TYPE,
  DEFAULT_API_KEY_PERMISSIONS,
  type ApiKeyType,
  type Permission,
} from "@owlmetry/shared/auth";

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// --- Create Key Dialog ---

function CreateKeyDialog({
  appId,
  teamId,
  onCreated,
}: {
  appId: string;
  teamId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [keyType, setKeyType] = useState<ApiKeyType>("client");
  const [permissions, setPermissions] = useState<Permission[]>([
    ...DEFAULT_API_KEY_PERMISSIONS.client,
  ]);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setKeyType("client");
    setPermissions([...DEFAULT_API_KEY_PERMISSIONS.client]);
    setExpiresInDays("");
    setError("");
    setLoading(false);
    setCreatedKey(null);
  }

  function handleTypeChange(type: ApiKeyType) {
    setKeyType(type);
    setPermissions([...DEFAULT_API_KEY_PERMISSIONS[type]]);
  }

  function togglePermission(perm: Permission) {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const body: Record<string, unknown> = {
        name,
        key_type: keyType,
        permissions,
      };
      if (keyType === "client") {
        body.app_id = appId;
      } else {
        body.team_id = teamId;
      }
      if (expiresInDays) {
        body.expires_in_days = Number(expiresInDays);
      }

      const result = await api.post<CreateApiKeyResponse>(
        "/v1/auth/keys",
        body
      );
      setCreatedKey(result.key);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create key");
    } finally {
      setLoading(false);
    }
  }

  const allowedPermissions = ALLOWED_PERMISSIONS_BY_KEY_TYPE[keyType];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          New Key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Create a new API key for this app.
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="space-y-4">
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
              This key will only be shown once. Copy it now.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-xs break-all">
                {createdKey}
              </code>
              <CopyButton text={createdKey} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                placeholder="My API Key"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={keyType} onValueChange={(v) => handleTypeChange(v as ApiKeyType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="space-y-2">
                {allowedPermissions.map((perm) => (
                  <div key={perm} className="flex items-center gap-2">
                    <Checkbox
                      id={`perm-${perm}`}
                      checked={permissions.includes(perm)}
                      onCheckedChange={() => togglePermission(perm)}
                    />
                    <label
                      htmlFor={`perm-${perm}`}
                      className="text-sm cursor-pointer"
                    >
                      {perm}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="key-expires">Expires in (days)</Label>
              <Input
                id="key-expires"
                type="number"
                min="1"
                placeholder="No expiry"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="submit" disabled={loading || permissions.length === 0}>
                {loading ? "Creating..." : "Create Key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Edit Key Dialog ---

function EditKeyDialog({
  apiKey,
  onUpdated,
}: {
  apiKey: ApiKeyResponse;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(apiKey.name);
  const [permissions, setPermissions] = useState<Permission[]>([
    ...apiKey.permissions,
  ]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setName(apiKey.name);
    setPermissions([...apiKey.permissions]);
    setError("");
  }

  function togglePermission(perm: Permission) {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.patch<GetApiKeyResponse>(`/v1/auth/keys/${apiKey.id}`, {
        name,
        permissions,
      });
      setOpen(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update key");
    } finally {
      setLoading(false);
    }
  }

  const allowedPermissions = ALLOWED_PERMISSIONS_BY_KEY_TYPE[apiKey.key_type];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Edit key">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit API Key</DialogTitle>
          <DialogDescription>
            Update the name or permissions for this key.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-key-name">Name</Label>
            <Input
              id="edit-key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Permissions</Label>
            <div className="space-y-2">
              {allowedPermissions.map((perm) => (
                <div key={perm} className="flex items-center gap-2">
                  <Checkbox
                    id={`edit-perm-${perm}`}
                    checked={permissions.includes(perm)}
                    onCheckedChange={() => togglePermission(perm)}
                  />
                  <label
                    htmlFor={`edit-perm-${perm}`}
                    className="text-sm cursor-pointer"
                  >
                    {perm}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={loading || permissions.length === 0}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Revoke Key Dialog ---

function RevokeKeyDialog({
  apiKey,
  onRevoked,
}: {
  apiKey: ApiKeyResponse;
  onRevoked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRevoke() {
    setError("");
    setLoading(true);
    try {
      await api.delete<DeleteApiKeyResponse>(`/v1/auth/keys/${apiKey.id}`);
      setOpen(false);
      onRevoked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke key");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setError("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Revoke key">
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke API Key</DialogTitle>
          <DialogDescription>
            This will permanently revoke &ldquo;{apiKey.name}&rdquo;. Any
            applications using this key will stop working. This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleRevoke}
            disabled={loading}
          >
            {loading ? "Revoking..." : "Revoke Key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Page ---

export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: app } = useSWR<AppResponse>(`/v1/apps/${id}`);

  const [search, setSearch] = useState("");
  const [anonymousFilter, setAnonymousFilter] = useState("");

  const filters = useMemo<AppUsersQueryParams>(() => {
    const f: AppUsersQueryParams = {};
    if (search) f.search = search;
    if (anonymousFilter && anonymousFilter !== "all") f.is_anonymous = anonymousFilter;
    return f;
  }, [search, anonymousFilter]);

  const { users, isLoading, isLoadingMore, hasMore, loadMore } = useAppUsers(id, filters);
  const { apiKeys, mutate: mutateKeys } = useApiKeys();

  // Filter keys: app-scoped client keys + team-scoped agent keys
  const filteredKeys = useMemo(() => {
    if (!app) return [];
    return apiKeys.filter(
      (k) => k.app_id === id || (k.key_type === "agent" && k.team_id === app.team_id)
    );
  }, [apiKeys, id, app]);

  if (!app) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/dashboard/projects/${app.project_id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">{app.name}</h1>
          <p className="text-sm text-muted-foreground">
            {app.platform}{app.bundle_id ? ` \u00B7 ${app.bundle_id}` : ""}
          </p>
        </div>
      </div>

      {/* App info */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {app.client_key && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Client Key:</span>
            <code className="bg-muted px-1.5 py-0.5 text-xs">
              {app.client_key.slice(0, 20)}...
            </code>
            <CopyButton text={app.client_key} />
          </div>
        )}
        <Link href={`/dashboard/events?app_id=${id}`}>
          <Button variant="outline" size="sm">View Events</Button>
        </Link>
      </div>

      {/* API Keys section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-medium">API Keys</h2>
          </div>
          <CreateKeyDialog
            appId={id}
            teamId={app.team_id}
            onCreated={() => mutateKeys()}
          />
        </div>

        {filteredKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys found.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[80px]">Type</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead className="w-[100px]">Created</TableHead>
                  <TableHead className="w-[100px]">Last Used</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="text-sm py-1.5">{key.name}</TableCell>
                    <TableCell className="py-1.5">
                      <Badge
                        variant={key.key_type === "agent" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {key.key_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <code className="text-xs text-muted-foreground">
                        {key.key_prefix}...
                      </code>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {key.permissions.map((perm) => (
                          <Badge
                            key={perm}
                            variant="outline"
                            className="text-[10px] px-1 py-0"
                          >
                            {perm}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs py-1.5">
                      {formatRelativeTime(key.created_at)}
                    </TableCell>
                    <TableCell className="text-xs py-1.5">
                      {key.last_used_at
                        ? formatRelativeTime(key.last_used_at)
                        : "Never"}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <div className="flex items-center gap-0.5">
                        <EditKeyDialog
                          apiKey={key}
                          onUpdated={() => mutateKeys()}
                        />
                        <RevokeKeyDialog
                          apiKey={key}
                          onRevoked={() => mutateKeys()}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Users section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-medium">Users</h2>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search user IDs..."
                className="w-[220px] h-8 text-xs pl-7"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Type</label>
            <Select value={anonymousFilter} onValueChange={setAnonymousFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                <SelectItem value="false">Real users</SelectItem>
                <SelectItem value="true">Anonymous</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Auto-refresh indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Auto-refreshing every 30s
        </div>

        {/* Users table */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading users...</p>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-sm">No users found</p>
            <p className="text-xs mt-1">Users appear here after events are ingested</p>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead className="w-[100px]">Type</TableHead>
                    <TableHead className="w-[100px]">Claims</TableHead>
                    <TableHead className="w-[160px]">First Seen</TableHead>
                    <TableHead className="w-[160px]">Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-mono text-xs py-1.5">
                        <Link
                          href={`/dashboard/events?app_id=${id}&user_id=${user.user_id}`}
                          className="hover:underline"
                        >
                          {user.user_id}
                        </Link>
                      </TableCell>
                      <TableCell className="py-1.5">
                        {user.is_anonymous ? (
                          <Badge variant="secondary" className="text-xs">anon</Badge>
                        ) : (
                          <Badge variant="default" className="text-xs">real</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs py-1.5">
                        {user.claimed_from?.length ?? 0}
                      </TableCell>
                      <TableCell className="text-xs py-1.5" title={user.first_seen_at}>
                        {new Date(user.first_seen_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs py-1.5" title={user.last_seen_at}>
                        {new Date(user.last_seen_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "Loading..." : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
