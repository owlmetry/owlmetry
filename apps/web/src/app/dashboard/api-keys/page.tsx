"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/format-date";
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
import { useApiKeys } from "@/hooks/use-api-keys";
import { useAppColorMap } from "@/hooks/use-project-colors";
import { useTeam } from "@/contexts/team-context";
import { api, ApiError } from "@/lib/api";
import { ProjectDot } from "@/lib/project-color";
import type {
  ApiKeyResponse,
  AppResponse,
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
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { TableSkeleton } from "@/components/ui/skeletons";

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
  return formatDate(dateStr);
}

// --- Create Key Dialog ---

function CreateKeyDialog({
  teamId,
  onCreated,
}: {
  teamId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [keyType, setKeyType] = useState<ApiKeyType>("client");
  const [selectedAppId, setSelectedAppId] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([
    ...DEFAULT_API_KEY_PERMISSIONS.client,
  ]);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    open ? `/v1/apps?team_id=${teamId}` : null
  );

  function resetForm() {
    setName("");
    setKeyType("client");
    setSelectedAppId("");
    setPermissions([...DEFAULT_API_KEY_PERMISSIONS.client]);
    setExpiresInDays("");
    setError("");
    setLoading(false);
    setCreatedKey(null);
  }

  function handleTypeChange(type: ApiKeyType) {
    setKeyType(type);
    setSelectedAppId("");
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
      if (keyType === "client" || keyType === "import") {
        if (!selectedAppId) {
          setError(`Please select an app for the ${keyType} key`);
          setLoading(false);
          return;
        }
        body.app_id = selectedAppId;
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
      setCreatedKey(result.api_key.secret);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create key");
    } finally {
      setLoading(false);
    }
  }

  const allowedPermissions = ALLOWED_PERMISSIONS_BY_KEY_TYPE[keyType];
  const teamApps = appsData?.apps ?? [];

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
            Create a new API key for your team.
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
                  <SelectItem value="client">📱 Client</SelectItem>
                  <SelectItem value="agent">🕶️ Agent</SelectItem>
                  <SelectItem value="import">📦 Import</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(keyType === "client" || keyType === "import") && (
              <div className="space-y-2">
                <Label>App</Label>
                <Select value={selectedAppId} onValueChange={setSelectedAppId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an app" />
                  </SelectTrigger>
                  <SelectContent>
                    {teamApps.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.platform})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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

export default function ApiKeysPage() {
  const { currentTeam } = useTeam();
  const { apiKeys, isLoading, mutate: mutateKeys } = useApiKeys(currentTeam?.id ?? null);
  const appColorMap = useAppColorMap(currentTeam?.id);

  if (!currentTeam) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <AnimatedPage className="space-y-6">
      <StaggerItem index={0}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">API Keys</h1>
        <CreateKeyDialog
          teamId={currentTeam.id}
          onCreated={() => mutateKeys()}
        />
      </div>
      </StaggerItem>

      <StaggerItem index={1}>
      {isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : apiKeys.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No API keys found</p>
          <p className="text-xs mt-1">Create a key to get started</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[80px]">Type</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead className="w-[100px]">Created</TableHead>
                <TableHead className="w-[100px]">Last Used</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="text-sm py-1.5">{key.name}</TableCell>
                  <TableCell className="py-1.5">
                    <Badge
                      variant={key.key_type === "agent" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {{ client: "📱 client", agent: "🕶️ agent", import: "📦 import" }[key.key_type] ?? key.key_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm py-1.5 text-muted-foreground">
                    {key.app_id ? (
                      <span className="flex items-center gap-1.5">
                        <ProjectDot color={appColorMap.get(key.app_id)} size={6} />
                        <span>{key.app_name ?? "\u2014"}</span>
                      </span>
                    ) : (
                      "\u2014"
                    )}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <code className="text-xs text-muted-foreground">
                      {key.secret.slice(0, 20)}...
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
                  <TableCell className="text-xs py-1.5 text-muted-foreground">
                    {key.created_by_email ?? "\u2014"}
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
      </StaggerItem>
    </AnimatedPage>
  );
}
