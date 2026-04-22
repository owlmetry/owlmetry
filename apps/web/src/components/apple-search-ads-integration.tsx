"use client";

import { useEffect, useState } from "react";
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
import { CopyButton } from "@/components/copy-button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CopyIntegrationDialog } from "@/components/copy-integration-dialog";
import { DetailSkeleton } from "@/components/ui/skeletons";
import { api, ApiError } from "@/lib/api";
import type { IntegrationResponse } from "@owlmetry/shared";
import {
  hasAllAppleAdsUserConfigKeys,
  INTEGRATION_PROVIDER_IDS,
} from "@owlmetry/shared/integrations";

interface AppleAdsUpdateForm {
  client_id: string;
  team_id: string;
  key_id: string;
  org_id: string;
}

const EMPTY_UPDATE_FORM: AppleAdsUpdateForm = {
  client_id: "",
  team_id: "",
  key_id: "",
  org_id: "",
};

interface TestResult {
  ok: boolean;
  message: string;
  orgs?: Array<{ org_id: number; org_name: string; matches_configured_org_id: boolean }>;
}

interface LastSyncStatus {
  last_sync: {
    id: string;
    status: string;
    created_at: string;
    completed_at: string | null;
    aborted: boolean;
    abort_reason: string | null;
    enriched: number;
    examined: number;
    errors: number;
    error_status_counts: Record<string, number>;
  } | null;
}

export function AppleSearchAdsIntegration({ projectId }: { projectId: string }) {
  const { data, mutate, isLoading } = useSWR<{ integrations: IntegrationResponse[] }>(
    `/v1/projects/${projectId}/integrations`
  );
  const { data: statusData, mutate: mutateStatus } = useSWR<LastSyncStatus>(
    `/v1/projects/${projectId}/integrations/apple-search-ads/status`,
    { refreshInterval: 15_000 },
  );
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateForm, setUpdateForm] = useState<AppleAdsUpdateForm>(EMPTY_UPDATE_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [connecting, setConnecting] = useState(false);

  const integration = data?.integrations?.find((i) => i.provider === INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS);
  const setupComplete = integration ? hasAllAppleAdsUserConfigKeys(integration.config) : false;

  function setUpdateField<K extends keyof AppleAdsUpdateForm>(key: K, value: AppleAdsUpdateForm[K]) {
    setUpdateForm((f) => ({ ...f, [key]: value }));
  }

  async function handleConnect() {
    setError("");
    setConnecting(true);
    try {
      await api.post(`/v1/projects/${projectId}/integrations`, {
        provider: INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS,
        config: {},
      });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }

  async function handleSaveUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!integration) return;
    setError("");
    setSaving(true);
    try {
      const config = Object.fromEntries(Object.entries(updateForm).filter(([, v]) => v.length > 0));
      await api.patch(`/v1/projects/${projectId}/integrations/apple-search-ads`, { config });
      setUpdateDialogOpen(false);
      setUpdateForm(EMPTY_UPDATE_FORM);
      setTestResult(null);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ ok: true; orgs: TestResult["orgs"] }>(
        `/v1/projects/${projectId}/integrations/apple-search-ads/test`,
        {},
      );
      setTestResult({ ok: true, message: "Credentials valid.", orgs: res.orgs });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to test";
      setTestResult({ ok: false, message });
    } finally {
      setTesting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      await api.post(`/v1/projects/${projectId}/integrations/apple-search-ads/sync`, {});
      setTimeout(() => mutateStatus(), 1000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to sync");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Remove Apple Search Ads integration? This deletes the server-held keypair — you'll need to upload a new public key to Apple if you reconnect.")) return;
    setError("");
    try {
      await api.delete(`/v1/projects/${projectId}/integrations/apple-search-ads`);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Apple Search Ads</CardTitle>
          <div className="flex items-center gap-2">
            {integration && (
              <Badge variant={integration.enabled ? "default" : "secondary"} className="text-xs">
                {integration.enabled ? "Active" : "Pending setup"}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && !integration ? (
          <DetailSkeleton />
        ) : integration && !setupComplete ? (
          <PendingSetup
            projectId={projectId}
            integration={integration}
            onProgress={() => mutate()}
            onRemove={handleRemove}
          />
        ) : integration ? (
          <>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Client ID</span>
                <span className="font-mono text-xs truncate max-w-[60%]">{integration.config.client_id ?? "Not set"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Team ID</span>
                <span className="font-mono text-xs truncate max-w-[60%]">{integration.config.team_id ?? "Not set"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Key ID</span>
                <span className="font-mono text-xs truncate max-w-[60%]">{integration.config.key_id ?? "Not set"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Org ID</span>
                <span className="font-mono text-xs">{integration.config.org_id ?? "Not set"}</span>
              </div>
            </div>

            <LastSyncStrip status={statusData?.last_sync ?? null} />

            {testResult && (
              <div
                className={`rounded-md border px-3 py-2 text-xs flex items-start gap-2 ${
                  testResult.ok ? "border-emerald-600/30 bg-emerald-950/20 text-emerald-300" : "border-destructive/30 bg-destructive/10 text-destructive"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                )}
                <div className="space-y-1">
                  <div>{testResult.message}</div>
                  {testResult.orgs && testResult.orgs.length > 0 && (
                    <ul className="space-y-0.5">
                      {testResult.orgs.map((o) => (
                        <li key={o.org_id} className="font-mono">
                          {o.matches_configured_org_id ? "✓" : " "} {o.org_id} — {o.org_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2 flex-wrap">
              <UpdateConfigDialog
                open={updateDialogOpen}
                onOpenChange={setUpdateDialogOpen}
                form={updateForm}
                setField={setUpdateField}
                onSubmit={handleSaveUpdate}
                saving={saving}
                error={error}
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Update IDs
                  </Button>
                }
              />

              <Button variant="outline" size="sm" onClick={handleTestConnection} disabled={testing}>
                <CheckCircle2 className={`h-3.5 w-3.5 mr-1.5 ${testing ? "animate-spin" : ""}`} />
                {testing ? "Testing..." : "Test Connection"}
              </Button>

              <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync All Users"}
              </Button>

              <Button variant="ghost" size="sm" onClick={handleRemove}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect Apple Search Ads to resolve campaign, ad group, keyword, and ad IDs into
              human-readable names on attributed users.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-center gap-2">
              <Button onClick={handleConnect} disabled={connecting}>
                <Plus className="h-4 w-4 mr-1.5" />
                {connecting ? "Generating keypair..." : "Connect Apple Search Ads"}
              </Button>
              <CopyIntegrationDialog
                targetProjectId={projectId}
                provider={INTEGRATION_PROVIDER_IDS.APPLE_SEARCH_ADS}
                providerLabel="Apple Search Ads"
                onCopied={() => mutate()}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Inline "Finish setup" content for a pending apple-search-ads integration.
 * Walks the user through: (1) copy the server-generated public key and paste
 * it into ads.apple.com, (2) paste the three IDs Apple returned, (3) pick
 * which org to attach. Each step commits to the server immediately, so the
 * user can close the browser and resume from any step on return.
 */
function PendingSetup({
  projectId,
  integration,
  onProgress,
  onRemove,
}: {
  projectId: string;
  integration: IntegrationResponse;
  onProgress: () => void;
  onRemove: () => void;
}) {
  const cfg = integration.config;
  const publicKey = cfg.public_key_pem || "";
  const savedClientId = cfg.client_id || "";
  const savedTeamId = cfg.team_id || "";
  const savedKeyId = cfg.key_id || "";
  const credsComplete = Boolean(savedClientId && savedTeamId && savedKeyId);

  return (
    <div className="space-y-5">
      <StepOneCopyPublicKey publicKey={publicKey} />
      <StepTwoPasteIds
        projectId={projectId}
        initialClientId={savedClientId}
        initialTeamId={savedTeamId}
        initialKeyId={savedKeyId}
        onSaved={onProgress}
      />
      {credsComplete && (
        <StepThreePickOrg projectId={projectId} onPicked={onProgress} />
      )}
      <div className="pt-2 border-t flex justify-end">
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5 mr-1.5 text-destructive" />
          <span className="text-destructive">Cancel setup</span>
        </Button>
      </div>
    </div>
  );
}

function StepOneCopyPublicKey({ publicKey }: { publicKey: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">1. Upload your public key to Apple</p>
          <p className="text-xs text-muted-foreground">
            Copy this public key, then add it at{" "}
            <a
              href="https://app-ads.apple.com/cm/app/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              ads.apple.com → Account Settings → User Management
            </a>
            {" "}on an API user (role: <span className="font-mono">API Account Read Only</span>). Apple will respond with three IDs.
          </p>
        </div>
        <CopyButton text={publicKey} />
      </div>
      <pre className="text-[11px] bg-muted/50 border rounded-md p-3 font-mono overflow-auto max-h-40 whitespace-pre-wrap break-all">
        {publicKey || "(generating...)"}
      </pre>
    </div>
  );
}

function StepTwoPasteIds({
  projectId,
  initialClientId,
  initialTeamId,
  initialKeyId,
  onSaved,
}: {
  projectId: string;
  initialClientId: string;
  initialTeamId: string;
  initialKeyId: string;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState(initialClientId);
  const [teamId, setTeamId] = useState(initialTeamId);
  const [keyId, setKeyId] = useState(initialKeyId);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-sync form state when the integration reloads (e.g., after external update).
  useEffect(() => {
    setClientId(initialClientId);
    setTeamId(initialTeamId);
    setKeyId(initialKeyId);
  }, [initialClientId, initialTeamId, initialKeyId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.patch(`/v1/projects/${projectId}/integrations/apple-search-ads`, {
        config: {
          client_id: clientId.trim(),
          team_id: teamId.trim(),
          key_id: keyId.trim(),
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const alreadySaved = Boolean(initialClientId && initialTeamId && initialKeyId);

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm font-medium">2. Paste the three IDs Apple returned</p>
      <div className="space-y-1.5">
        <Label htmlFor="pending-client-id">Client ID</Label>
        <Input
          id="pending-client-id"
          placeholder="SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pending-team-id">Team ID</Label>
        <Input
          id="pending-team-id"
          placeholder="SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pending-key-id">Key ID</Label>
        <Input
          id="pending-key-id"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={keyId}
          onChange={(e) => setKeyId(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? "Saving..." : alreadySaved ? "Update IDs" : "Save IDs"}
      </Button>
    </form>
  );
}

function StepThreePickOrg({
  projectId,
  onPicked,
}: {
  projectId: string;
  onPicked: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<Array<{ org_id: number; org_name: string }>>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.post<{ ok: true; orgs: Array<{ org_id: number; org_name: string }> }>(
          `/v1/projects/${projectId}/integrations/apple-search-ads/discover-orgs`,
          {},
        );
        if (cancelled) return;
        setOrgs(res.orgs);
        if (res.orgs.length === 1) setSelected(String(res.orgs[0].org_id));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Failed to reach Apple Ads");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError("");
    setSaving(true);
    try {
      await api.patch(`/v1/projects/${projectId}/integrations/apple-search-ads`, {
        config: { org_id: selected },
      });
      onPicked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm font-medium">3. Pick the account</p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Fetching your accounts from Apple…</p>
      ) : error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive px-3 py-2 text-xs flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      ) : orgs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No accounts available on these credentials.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="pending-org">Account</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger id="pending-org">
                <SelectValue placeholder="Select an account" />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((o) => (
                  <SelectItem key={o.org_id} value={String(o.org_id)}>
                    {o.org_name} — {o.org_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={saving || !selected}>
            {saving ? "Finishing..." : "Finish setup"}
          </Button>
        </>
      )}
    </form>
  );
}

function UpdateConfigDialog({
  open,
  onOpenChange,
  form,
  setField,
  onSubmit,
  saving,
  error,
  trigger,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: AppleAdsUpdateForm;
  setField: <K extends keyof AppleAdsUpdateForm>(key: K, value: AppleAdsUpdateForm[K]) => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  error: string;
  trigger: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Update Apple Search Ads IDs</DialogTitle>
          <DialogDescription>
            Leave a field blank to keep the existing value. To rotate the keypair itself, remove the integration and reconnect — the server generates the private key.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="aa-client-id">Client ID</Label>
            <Input
              id="aa-client-id"
              placeholder="SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={form.client_id}
              onChange={(e) => setField("client_id", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aa-team-id">Team ID</Label>
            <Input
              id="aa-team-id"
              placeholder="SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={form.team_id}
              onChange={(e) => setField("team_id", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aa-key-id">Key ID</Label>
            <Input
              id="aa-key-id"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={form.key_id}
              onChange={(e) => setField("key_id", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aa-org-id">Org ID (Account ID)</Label>
            <Input
              id="aa-org-id"
              placeholder="40669820"
              value={form.org_id}
              onChange={(e) => setField("org_id", e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LastSyncStrip({ status }: { status: LastSyncStatus["last_sync"] }) {
  if (!status) {
    return (
      <div className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        No syncs run yet — trigger one to backfill names on existing attributed users.
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
          {variant === "warn" && `Last sync finished with ${status.errors} field error${status.errors === 1 ? "" : "s"} — ${when}`}
          {variant === "success" && `Last sync OK — ${when}`}
        </div>
        {status.aborted && status.abort_reason && (
          <div className="font-mono break-all opacity-90">{status.abort_reason}</div>
        )}
        {!status.aborted && status.examined > 0 && (
          <div className="opacity-80">
            Enriched {status.enriched} of {status.examined} users examined
            {status.errors > 0 && ` — ${JSON.stringify(status.error_status_counts)}`}
          </div>
        )}
      </div>
    </div>
  );
}
