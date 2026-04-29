"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, Pencil, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
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
import type { IntegrationResponse, CreateIntegrationResponse, WebhookSetup } from "@owlmetry/shared";

const PROVIDER = "revenuecat";

export function RevenueCatIntegration({ projectId }: { projectId: string }) {
  const { data, mutate, isLoading } = useSWR<{ integrations: IntegrationResponse[] }>(
    `/v1/projects/${projectId}/integrations`
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingWebhookSetup, setPendingWebhookSetup] = useState<WebhookSetup | null>(null);

  const integration = data?.integrations?.find((i) => i.provider === PROVIDER);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const config: Record<string, string> = {};
      if (apiKey) config.api_key = apiKey;

      if (integration) {
        await api.patch(`/v1/projects/${projectId}/integrations/${PROVIDER}`, { config });
      } else {
        const response = await api.post<CreateIntegrationResponse>(
          `/v1/projects/${projectId}/integrations`,
          { provider: PROVIDER, config }
        );
        if (response.webhook_setup) {
          setPendingWebhookSetup(response.webhook_setup);
        }
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
      await api.patch(`/v1/projects/${projectId}/integrations/${PROVIDER}`, { enabled: !integration.enabled });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to toggle");
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      await api.post(`/v1/projects/${projectId}/integrations/${PROVIDER}/sync`, {});
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
      await api.delete(`/v1/projects/${projectId}/integrations/${PROVIDER}`);
      setPendingWebhookSetup(null);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove");
    }
  }

  function handleFinishSetup() {
    setPendingWebhookSetup(null);
    mutate();
    handleSync();
  }

  const webhookUrl = `${API_URL}/v1/webhooks/revenuecat/${projectId}`;
  const showPending = Boolean(pendingWebhookSetup && integration);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">RevenueCat</CardTitle>
          <div className="flex items-center gap-2">
            {integration && (
              <>
                {showPending ? (
                  <IntegrationStatusBadge enabled={false} disabledLabel="Pending setup" />
                ) : (
                  <>
                    <IntegrationStatusBadge enabled={integration.enabled} />
                    <Button variant="ghost" size="sm" onClick={handleToggle}>
                      {integration.enabled ? "Disable" : "Enable"}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && !integration ? (
          <DetailSkeleton />
        ) : showPending && pendingWebhookSetup ? (
          <PendingWebhookSetup
            webhookSetup={pendingWebhookSetup}
            onDone={handleFinishSetup}
            onCancel={handleRemove}
          />
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
                    <PermissionsCallout />
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
                    Generate a V2 Secret API key at{" "}
                    <a
                      href="https://app.revenuecat.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      RevenueCat → Project Settings → API Keys
                    </a>
                    {" "}(+ New secret API key). After connecting, we&apos;ll show you the webhook configuration to paste into RevenueCat.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSave} className="space-y-4">
                  <PermissionsCallout />
                  <div className="space-y-2">
                    <Label htmlFor="rc-api-key-new">API Key (Secret)</Label>
                    <Input id="rc-api-key-new" type="password" placeholder="sk_..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
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
                provider={PROVIDER}
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

function PermissionsCallout() {
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1.5">
      <p className="font-medium text-foreground">Required permissions</p>
      <p className="text-muted-foreground">
        Set both sections to <span className="font-medium text-foreground">Read only</span> using the dropdown at the top-right of each section. All other sections: <span className="font-medium text-foreground">No access</span>.
      </p>
      <ul className="ml-4 list-disc text-muted-foreground space-y-0.5">
        <li>Customer information → Read only</li>
        <li>Project configuration → Read only</li>
      </ul>
    </div>
  );
}

function PendingWebhookSetup({
  webhookSetup,
  onDone,
  onCancel,
}: {
  webhookSetup: WebhookSetup;
  onDone: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-600/30 bg-amber-950/20 text-amber-200 px-3 py-2 text-xs flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Save the authorization header now</p>
          <p className="opacity-90">It contains the webhook secret and won&apos;t be shown again. Lose it and you&apos;ll need to remove + re-add the integration.</p>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">Configure the webhook in RevenueCat</p>
        <p className="text-xs text-muted-foreground">
          In{" "}
          <a
            href="https://app.revenuecat.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            RevenueCat → Project Settings → Integrations → Webhooks
          </a>
          {" "}choose <span className="font-medium text-foreground">+ New Webhook</span> and paste the four values below.
        </p>
      </div>

      <WebhookSetupRow label="Webhook URL" value={webhookSetup.webhook_url} />
      <WebhookSetupRow label="Authorization header" value={webhookSetup.authorization_header} />
      <WebhookSetupRow label="Environment" value={webhookSetup.environment} mono={false} />
      <WebhookSetupRow label="Events filter" value={webhookSetup.events_filter} mono={false} />

      <div className="flex gap-2 flex-wrap pt-1">
        <Button size="sm" onClick={onDone}>I&apos;ve saved the webhook</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="text-destructive hover:text-destructive ml-auto">
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Cancel setup
        </Button>
      </div>
    </div>
  );
}

function WebhookSetupRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <CopyButton text={value} />
      </div>
      <pre className={`text-[11px] bg-muted/50 border rounded-md p-2 overflow-auto break-all whitespace-pre-wrap ${mono ? "font-mono" : ""}`}>
        {value}
      </pre>
    </div>
  );
}
