"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { IntegrationStatusBadge } from "@/components/badges/integration-status-badge";
import { CopyIntegrationDialog } from "@/components/copy-integration-dialog";
import { DetailSkeleton } from "@/components/ui/skeletons";
import { api, ApiError } from "@/lib/api";
import type { IntegrationResponse } from "@owlmetry/shared";
import { INTEGRATION_PROVIDER_IDS } from "@owlmetry/shared/integrations";

const PROVIDER = INTEGRATION_PROVIDER_IDS.APP_STORE_CONNECT;

interface AscForm {
  issuer_id: string;
  key_id: string;
  private_key_p8: string;
}

const EMPTY_FORM: AscForm = { issuer_id: "", key_id: "", private_key_p8: "" };

interface DiscoveredApp {
  id: string;
  name: string;
  bundle_id: string;
}

interface TestResult {
  ok: boolean;
  message: string;
  apps?: DiscoveredApp[];
}

interface LastSyncStatus {
  last_sync: {
    id: string;
    status: string;
    created_at: string;
    completed_at: string | null;
    aborted: boolean;
    abort_reason: string | null;
    enriched: number; // = reviews_ingested (ASA shape reused)
    examined: number; // = pages_fetched
    errors: number;
    error_status_counts: Record<string, number>;
  } | null;
}

export function AppStoreConnectIntegration({ projectId }: { projectId: string }) {
  const { data, mutate, isLoading } = useSWR<{ integrations: IntegrationResponse[] }>(
    `/v1/projects/${projectId}/integrations`,
  );
  const { data: statusData, mutate: mutateStatus } = useSWR<LastSyncStatus>(
    `/v1/projects/${projectId}/integrations/app-store-connect/status`,
    { refreshInterval: 15_000 },
  );

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [form, setForm] = useState<AscForm>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const integration = data?.integrations?.find((i) => i.provider === PROVIDER);

  function setField<K extends keyof AscForm>(key: K, value: AscForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function resetCreate() {
    setForm(EMPTY_FORM);
    setError("");
    setSaving(false);
    setTestResult(null);
  }

  function resetUpdate() {
    setForm(EMPTY_FORM);
    setError("");
    setSaving(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post(`/v1/projects/${projectId}/integrations`, {
        provider: PROVIDER,
        config: {
          issuer_id: form.issuer_id.trim(),
          key_id: form.key_id.trim(),
          private_key_p8: form.private_key_p8.trim(),
        },
      });
      await mutate();
      await mutateStatus();
      setCreateDialogOpen(false);
      resetCreate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!integration) return;
    setError("");
    setSaving(true);
    try {
      // Only send fields the user filled in. Empty private_key_p8 keeps the
      // existing one (server merges over existing config).
      const config: Record<string, string> = {};
      if (form.issuer_id.trim()) config.issuer_id = form.issuer_id.trim();
      if (form.key_id.trim()) config.key_id = form.key_id.trim();
      if (form.private_key_p8.trim()) config.private_key_p8 = form.private_key_p8.trim();
      await api.patch(`/v1/projects/${projectId}/integrations/${PROVIDER}`, { config });
      await mutate();
      await mutateStatus();
      setUpdateDialogOpen(false);
      resetUpdate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ ok: boolean; apps: DiscoveredApp[] }>(
        `/v1/projects/${projectId}/integrations/${PROVIDER}/test`,
        {},
      );
      setTestResult({ ok: true, message: `Connected. ${res.apps.length} app${res.apps.length === 1 ? "" : "s"} visible.`, apps: res.apps });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await api.post(`/v1/projects/${projectId}/integrations/${PROVIDER}/sync`, {});
      await mutateStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to trigger sync");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRemove() {
    if (!integration) return;
    if (!confirm("Remove the App Store Connect integration? Existing reviews stay; future syncs stop until you re-add it.")) return;
    setSaving(true);
    try {
      await api.delete(`/v1/projects/${projectId}/integrations/${PROVIDER}`);
      await mutate();
      await mutateStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <DetailSkeleton />;

  // No integration yet — show the connect card with a "Set up" button + a
  // "Copy from another project" affordance (handled by the existing
  // CopyIntegrationDialog).
  if (!integration) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>App Store Connect</CardTitle>
            <IntegrationStatusBadge enabled={false} disabledLabel="Not connected" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Pull Apple App Store reviews via the App Store Connect API. Requires an Individual API Key with the &quot;Customer Support&quot; role on your Apple Developer team.
          </p>
          <div className="flex gap-2">
            <Dialog open={createDialogOpen} onOpenChange={(o) => { setCreateDialogOpen(o); if (!o) resetCreate(); }}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> Set up</Button>
              </DialogTrigger>
              <CreateOrUpdateDialog
                title="Connect App Store Connect"
                form={form}
                setField={setField}
                onSubmit={handleCreate}
                saving={saving}
                error={error}
                isUpdate={false}
              />
            </Dialog>
            <CopyIntegrationDialog targetProjectId={projectId} provider={PROVIDER} providerLabel="App Store Connect" onCopied={() => { mutate(); mutateStatus(); }} />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Integration exists — show config summary + status strip + action buttons.
  const issuerId = (integration.config.issuer_id as string | undefined) ?? "";
  const keyId = (integration.config.key_id as string | undefined) ?? "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>App Store Connect</CardTitle>
          <IntegrationStatusBadge enabled={integration.enabled} disabledLabel="Disabled" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">Issuer ID</span>
          <span className="font-mono break-all">{issuerId}</span>
          <span className="text-muted-foreground">Key ID</span>
          <span className="font-mono">{keyId}</span>
          <span className="text-muted-foreground">Private key</span>
          <span className="text-muted-foreground italic">stored securely (never returned)</span>
        </div>

        <LastSyncStrip status={statusData?.last_sync ?? null} />

        {testResult && (
          <div className={`rounded-md border px-3 py-2 text-xs space-y-1 ${testResult.ok ? "border-emerald-600/30 bg-emerald-950/20 text-emerald-300" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
            <div className="font-medium">{testResult.message}</div>
            {testResult.apps && testResult.apps.length > 0 && (
              <ul className="list-disc list-inside opacity-90">
                {testResult.apps.slice(0, 8).map((a) => (
                  <li key={a.id}>{a.name} <span className="font-mono opacity-70">({a.bundle_id})</span></li>
                ))}
                {testResult.apps.length > 8 && <li className="opacity-70">… and {testResult.apps.length - 8} more</li>}
              </ul>
            )}
          </div>
        )}

        {error && <p className="text-destructive text-xs">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Dialog open={updateDialogOpen} onOpenChange={(o) => { setUpdateDialogOpen(o); if (!o) resetUpdate(); }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline"><Pencil className="h-3.5 w-3.5 mr-1" /> Update</Button>
            </DialogTrigger>
            <CreateOrUpdateDialog
              title="Update App Store Connect credentials"
              form={form}
              setField={setField}
              onSubmit={handleUpdate}
              saving={saving}
              error={error}
              isUpdate={true}
            />
          </Dialog>
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
            Test connection
          </Button>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            {syncing ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            Sync reviews
          </Button>
          <Button size="sm" variant="ghost" onClick={handleRemove} className="text-destructive hover:text-destructive ml-auto">
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateOrUpdateDialog({
  title,
  form,
  setField,
  onSubmit,
  saving,
  error,
  isUpdate,
}: {
  title: string;
  form: AscForm;
  setField: <K extends keyof AscForm>(k: K, v: AscForm[K]) => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  error: string;
  isUpdate: boolean;
}) {
  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          In App Store Connect → Users and Access → Integrations → App Store Connect API, generate an Individual Key with the <strong>Customer Support</strong> role. Download the .p8 (you only get one chance) and copy the Issuer ID and Key ID below.
          {isUpdate && " Leave the private key field blank to keep the existing key."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="asc-issuer-id">Issuer ID</Label>
          <Input
            id="asc-issuer-id"
            value={form.issuer_id}
            onChange={(e) => setField("issuer_id", e.target.value)}
            placeholder="57246542-96fe-1a63-e053-0824d011072a"
            className="font-mono text-xs"
            required={!isUpdate}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="asc-key-id">Key ID</Label>
          <Input
            id="asc-key-id"
            value={form.key_id}
            onChange={(e) => setField("key_id", e.target.value)}
            placeholder="ABC1234567"
            className="font-mono text-xs"
            required={!isUpdate}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="asc-p8">Private Key (.p8 contents){isUpdate && " — leave blank to keep existing"}</Label>
          <Textarea
            id="asc-p8"
            value={form.private_key_p8}
            onChange={(e) => setField("private_key_p8", e.target.value)}
            placeholder={"-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqG…\n-----END PRIVATE KEY-----"}
            className="font-mono text-xs min-h-[160px]"
            required={!isUpdate}
          />
          <p className="text-xs text-muted-foreground">
            Paste the full contents of the .p8 file. Owlmetry stores it securely and will never display it back.
          </p>
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
        <DialogFooter>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function LastSyncStrip({ status }: { status: LastSyncStatus["last_sync"] }) {
  if (!status) {
    return (
      <div className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        No syncs run yet — trigger one to pull reviews for every Apple app in this project.
      </div>
    );
  }

  const when = new Date(status.completed_at ?? status.created_at).toLocaleString();
  const variant = status.aborted || status.status === "failed"
    ? "error"
    : status.status === "running" || status.status === "pending"
      ? "running"
      : status.errors > 0
        ? "warn"
        : "success";

  const classes = {
    error: "border-destructive/30 bg-destructive/10 text-destructive",
    warn: "border-amber-600/30 bg-amber-950/20 text-amber-300",
    success: "border-emerald-600/30 bg-emerald-950/20 text-emerald-300",
    running: "border-muted-foreground/20 bg-muted/30 text-muted-foreground",
  }[variant];

  return (
    <div className={`rounded-md border px-3 py-2 text-xs flex items-start gap-2 ${classes}`}>
      {variant === "error" ? (
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      ) : variant === "running" ? (
        <RefreshCw className="h-3.5 w-3.5 mt-0.5 shrink-0 animate-spin" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      )}
      <div className="space-y-1 min-w-0">
        <div className="font-medium">
          {variant === "running" && `Sync ${status.status} — started ${when}`}
          {variant === "error" && `Last sync aborted — ${when}`}
          {variant === "warn" && `Last sync finished with ${status.errors} error${status.errors === 1 ? "" : "s"} — ${when}`}
          {variant === "success" && `Last sync OK — ${when}`}
        </div>
        {status.aborted && status.abort_reason && (
          <div className="font-mono break-all opacity-90">{status.abort_reason}</div>
        )}
        {!status.aborted && (
          <div className="opacity-80">
            Ingested {status.enriched} new review{status.enriched === 1 ? "" : "s"}{status.examined > 0 && ` across ${status.examined} page${status.examined === 1 ? "" : "s"}`}
            {status.errors > 0 && ` — ${JSON.stringify(status.error_status_counts)}`}
          </div>
        )}
      </div>
    </div>
  );
}
