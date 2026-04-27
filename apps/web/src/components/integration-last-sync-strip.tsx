import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

export interface IntegrationLastSyncStatus {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  aborted: boolean;
  abort_reason: string | null;
  /** Provider-defined "things successfully processed" count. */
  enriched: number;
  /** Provider-defined "things examined" count. */
  examined: number;
  errors: number;
  error_status_counts: Record<string, number>;
}

interface IntegrationLastSyncStripProps {
  status: IntegrationLastSyncStatus | null;
  /** Shown when no sync has ever run. e.g. "trigger one to backfill names". */
  emptyHint: string;
  /** Function to render the per-provider summary line ("Enriched 12 of 50 users", etc). */
  renderSummary: (s: IntegrationLastSyncStatus) => string;
  /** Word for the per-error-source breakdown (e.g. "field error" or "error"). */
  errorWord?: string;
}

/**
 * Shared "last sync" status strip for project-scoped integration components
 * (Apple Search Ads, App Store Connect, etc). Renders the variant icon +
 * timestamp + abort reason, and delegates the per-provider summary line to
 * the caller via `renderSummary`.
 */
export function IntegrationLastSyncStrip({
  status,
  emptyHint,
  renderSummary,
  errorWord = "error",
}: IntegrationLastSyncStripProps) {
  if (!status) {
    return (
      <div className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {emptyHint}
      </div>
    );
  }

  const when = new Date(status.completed_at ?? status.created_at).toLocaleString();
  const variant: "error" | "running" | "warn" | "success" =
    status.aborted || status.status === "failed"
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
          {variant === "warn" && `Last sync finished with ${status.errors} ${errorWord}${status.errors === 1 ? "" : "s"} — ${when}`}
          {variant === "success" && `Last sync OK — ${when}`}
        </div>
        {status.aborted && status.abort_reason && (
          <div className="font-mono break-all opacity-90">{status.abort_reason}</div>
        )}
        {!status.aborted && (
          <div className="opacity-80">
            {renderSummary(status)}
            {status.errors > 0 && ` — ${JSON.stringify(status.error_status_counts)}`}
          </div>
        )}
      </div>
    </div>
  );
}
