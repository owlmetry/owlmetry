"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, Pencil, Trash2, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

interface AppleAdsConfigForm {
  client_id: string;
  team_id: string;
  key_id: string;
  private_key_pem: string;
  org_id: string;
}

const EMPTY_FORM: AppleAdsConfigForm = {
  client_id: "",
  team_id: "",
  key_id: "",
  private_key_pem: "",
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<AppleAdsConfigForm>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const integration = data?.integrations?.find((i) => i.provider === "apple-search-ads");

  function setField<K extends keyof AppleAdsConfigForm>(key: K, value: AppleAdsConfigForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!integration) return;
    setError("");
    setSaving(true);
    try {
      // Drop blank fields (blank = keep existing).
      const config = Object.fromEntries(Object.entries(form).filter(([, v]) => v.length > 0));
      await api.patch(`/v1/projects/${projectId}/integrations/apple-search-ads`, { config });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
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

  async function handleToggle() {
    if (!integration) return;
    setError("");
    try {
      await api.patch(`/v1/projects/${projectId}/integrations/apple-search-ads`, {
        enabled: !integration.enabled,
      });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to toggle");
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      await api.post(`/v1/projects/${projectId}/integrations/apple-search-ads/sync`, {});
      // Nudge the status fetch so the strip reflects the new run sooner than
      // the 15s refresh tick.
      setTimeout(() => mutateStatus(), 1000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to sync");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRemove() {
    if (!confirm("Remove Apple Search Ads integration?")) return;
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
        {isLoading && !integration ? (
          <DetailSkeleton />
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
                <span className="text-muted-foreground">Private Key</span>
                <span className="font-mono text-xs">{integration.config.private_key_pem ?? "Not set"}</span>
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

            <div className="flex gap-2 flex-wrap">
              <ConfigDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                form={form}
                setField={setField}
                onSubmit={handleSave}
                saving={saving}
                error={error}
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Update Config
                  </Button>
                }
              />

              <Button variant="outline" size="sm" onClick={handleTestConnection} disabled={testing || !integration.enabled}>
                <CheckCircle2 className={`h-3.5 w-3.5 mr-1.5 ${testing ? "animate-spin" : ""}`} />
                {testing ? "Testing..." : "Test Connection"}
              </Button>

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
          <div className="text-center py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect Apple Search Ads to resolve campaign, ad group, keyword, and ad IDs into
              human-readable names on attributed users.
            </p>
            <div className="flex items-center justify-center gap-2">
              <ConnectDialog projectId={projectId} onConnected={() => mutate()} />
              <CopyIntegrationDialog
                targetProjectId={projectId}
                provider="apple-search-ads"
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

function ConfigDialog({
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
  form: AppleAdsConfigForm;
  setField: <K extends keyof AppleAdsConfigForm>(key: K, value: AppleAdsConfigForm[K]) => void;
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
          <DialogTitle>Update Apple Search Ads</DialogTitle>
          <DialogDescription>
            Leave a field blank to keep the existing value. Paste a new private key to rotate.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <AppleAdsConfigFormFields form={form} setField={setField} updating />
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

interface DiscoveredOrg {
  org_id: number;
  org_name: string;
}

interface Credentials {
  client_id: string;
  team_id: string;
  key_id: string;
  private_key_pem: string;
}

const EMPTY_CREDENTIALS: Credentials = {
  client_id: "",
  team_id: "",
  key_id: "",
  private_key_pem: "",
};

function ConnectDialog({
  projectId,
  onConnected,
}: {
  projectId: string;
  onConnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"credentials" | "pick-org">("credentials");
  const [credentials, setCredentials] = useState<Credentials>(EMPTY_CREDENTIALS);
  const [orgs, setOrgs] = useState<DiscoveredOrg[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [error, setError] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [connecting, setConnecting] = useState(false);

  function setField<K extends keyof Credentials>(key: K, value: Credentials[K]) {
    setCredentials((c) => ({ ...c, [key]: value }));
  }

  function reset() {
    setStep("credentials");
    setCredentials(EMPTY_CREDENTIALS);
    setOrgs([]);
    setSelectedOrgId("");
    setError("");
    setDiscovering(false);
    setConnecting(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function handleDiscoverOrgs(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDiscovering(true);
    try {
      const res = await api.post<{ ok: true; orgs: DiscoveredOrg[] }>(
        `/v1/projects/${projectId}/integrations/apple-search-ads/discover-orgs`,
        credentials,
      );
      setOrgs(res.orgs);
      // Auto-select when there's only one — the common case.
      if (res.orgs.length === 1) {
        setSelectedOrgId(String(res.orgs[0].org_id));
      }
      setStep("pick-org");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reach Apple Ads");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOrgId) {
      setError("Pick an account to continue.");
      return;
    }
    setError("");
    setConnecting(true);
    try {
      await api.post(`/v1/projects/${projectId}/integrations`, {
        provider: "apple-search-ads",
        config: { ...credentials, org_id: selectedOrgId },
      });
      handleOpenChange(false);
      onConnected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-1.5" />
          Connect Apple Search Ads
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect Apple Search Ads</DialogTitle>
          <DialogDescription>
            {step === "credentials" ? (
              <>
                Generate an EC P-256 keypair, upload the public key at{" "}
                <a
                  href="https://app-ads.apple.com/cm/app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  ads.apple.com
                </a>
                {" "}→ Account Settings → API, and paste the returned IDs plus your private key below.
              </>
            ) : (
              "Pick which Apple Ads account to connect. We found these from your credentials."
            )}
          </DialogDescription>
        </DialogHeader>

        {step === "credentials" ? (
          <form onSubmit={handleDiscoverOrgs} className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cx-client-id">Client ID</Label>
                <Input
                  id="cx-client-id"
                  placeholder="SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={credentials.client_id}
                  onChange={(e) => setField("client_id", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cx-team-id">Team ID</Label>
                <Input
                  id="cx-team-id"
                  placeholder="SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={credentials.team_id}
                  onChange={(e) => setField("team_id", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cx-key-id">Key ID</Label>
                <Input
                  id="cx-key-id"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={credentials.key_id}
                  onChange={(e) => setField("key_id", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cx-private-key">Private Key (PEM)</Label>
                <Textarea
                  id="cx-private-key"
                  rows={6}
                  placeholder="-----BEGIN EC PRIVATE KEY-----&#10;...&#10;-----END EC PRIVATE KEY-----"
                  value={credentials.private_key_pem}
                  onChange={(e) => setField("private_key_pem", e.target.value)}
                  required
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Generate with: <code className="font-mono">openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem</code>
                </p>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={discovering}>
                {discovering ? "Checking credentials..." : "Continue"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={handleConnect} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cx-org">Account</Label>
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger id="cx-org">
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
              <p className="text-xs text-muted-foreground">
                Apple calls this <code className="font-mono">orgId</code> in the API (shown as "Account ID" in ads.apple.com).
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setStep("credentials");
                  setError("");
                }}
                disabled={connecting}
              >
                Back
              </Button>
              <Button type="submit" disabled={connecting || !selectedOrgId}>
                {connecting ? "Connecting..." : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AppleAdsConfigFormFields({
  form,
  setField,
  updating,
}: {
  form: AppleAdsConfigForm;
  setField: <K extends keyof AppleAdsConfigForm>(key: K, value: AppleAdsConfigForm[K]) => void;
  updating: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="aa-client-id">Client ID</Label>
        <Input
          id="aa-client-id"
          placeholder="SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={form.client_id}
          onChange={(e) => setField("client_id", e.target.value)}
          required={!updating}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="aa-team-id">Team ID</Label>
        <Input
          id="aa-team-id"
          placeholder="SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={form.team_id}
          onChange={(e) => setField("team_id", e.target.value)}
          required={!updating}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="aa-key-id">Key ID</Label>
        <Input
          id="aa-key-id"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={form.key_id}
          onChange={(e) => setField("key_id", e.target.value)}
          required={!updating}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="aa-private-key">Private Key (PEM)</Label>
        <Textarea
          id="aa-private-key"
          rows={6}
          placeholder="-----BEGIN EC PRIVATE KEY-----&#10;...&#10;-----END EC PRIVATE KEY-----"
          value={form.private_key_pem}
          onChange={(e) => setField("private_key_pem", e.target.value)}
          required={!updating}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Generate with: <code className="font-mono">openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem</code>
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="aa-org-id">Org ID (Account ID)</Label>
        <Input
          id="aa-org-id"
          placeholder="40669820"
          value={form.org_id}
          onChange={(e) => setField("org_id", e.target.value)}
          required={!updating}
        />
        <p className="text-xs text-muted-foreground">
          At ads.apple.com, click your name in the top-right → the number shown as <span className="font-medium">Account ID</span> under your org name. Apple calls this <code className="font-mono">orgId</code> in the API.
        </p>
      </div>
    </div>
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
