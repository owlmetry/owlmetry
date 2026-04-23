"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
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
import { CopyIntegrationDialog } from "@/components/copy-integration-dialog";
import { IntegrationStatusBadge } from "@/components/badges/integration-status-badge";
import { DetailSkeleton } from "@/components/ui/skeletons";
import { api, ApiError, API_URL } from "@/lib/api";
import type { IntegrationResponse } from "@owlmetry/shared";

export function RevenueCatIntegration({ projectId }: { projectId: string }) {
  const { data, mutate, isLoading } = useSWR<{ integrations: IntegrationResponse[] }>(
    `/v1/projects/${projectId}/integrations`
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
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

      if (integration) {
        await api.patch(`/v1/projects/${projectId}/integrations/revenuecat`, { config });
      } else {
        await api.post(`/v1/projects/${projectId}/integrations`, { provider: "revenuecat", config });
      }
      setDialogOpen(false);
      setApiKey("");
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
                <IntegrationStatusBadge enabled={integration.enabled} />
                <Button variant="ghost" size="sm" onClick={handleToggle}>
                  {integration.enabled ? "Disable" : "Enable"}
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && !integration ? (
          <DetailSkeleton />
        ) : integration ? (
          <>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">API Key</span>
                <span className="font-mono text-xs">{integration.config.api_key ?? "Not set"}</span>
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
            <div className="flex items-center justify-center gap-2">
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
                    <p className="text-xs text-muted-foreground">V2 Secret API key from RevenueCat → Project Settings → API Keys.</p>
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <DialogFooter>
                    <Button type="submit" disabled={saving}>{saving ? "Connecting..." : "Connect"}</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
              <CopyIntegrationDialog
                targetProjectId={projectId}
                provider="revenuecat"
                providerLabel="RevenueCat"
                onCopied={() => mutate()}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

