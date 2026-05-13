"use client";

import { useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MetricPhaseBadge } from "@/components/badges/metric-phase-badge";
import { VersionRow } from "@/components/version-badge";
import { DetailRow } from "@/components/detail-row";
import { ProjectDot } from "@/lib/project-color";
import { formatDateTime } from "@/lib/format-date";
import { formatSdkLabel } from "@/lib/format-sdk";
import { countryFlag } from "@/lib/country-flag";
import { buildQueryString } from "@/lib/query";
// Deep import bypasses the barrel export which pulls in node:crypto
import { formatDuration } from "@owlmetry/shared/constants";
import type {
  DataMode,
  MetricEventsResponse,
  MetricPhase,
  StoredMetricEventResponse,
} from "@owlmetry/shared";

interface MetricEventDetailSheetProps {
  trackingId: string | null;
  initialEvent: StoredMetricEventResponse | null;
  metricSlug: string | undefined;
  projectId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilter?: (key: string, value: string) => void;
  projectColor?: string;
  latestAppVersion?: string | null;
  dataMode?: DataMode;
}

const END_PHASES: MetricPhase[] = ["complete", "fail", "cancel"];

const OUTCOME_META: Record<
  MetricPhase | "in_progress",
  { emoji: string; label: string; tone: "blue" | "green" | "red" | "yellow" | "cyan" }
> = {
  start: { emoji: "⏳", label: "in progress", tone: "blue" },
  complete: { emoji: "✅", label: "completed", tone: "green" },
  fail: { emoji: "❌", label: "failed", tone: "red" },
  cancel: { emoji: "🚫", label: "cancelled", tone: "yellow" },
  record: { emoji: "📝", label: "recorded", tone: "cyan" },
  in_progress: { emoji: "⏳", label: "in progress", tone: "blue" },
};

export function MetricEventDetailSheet({
  trackingId,
  initialEvent,
  metricSlug,
  projectId,
  open,
  onOpenChange,
  onFilter,
  projectColor,
  latestAppVersion,
  dataMode,
}: MetricEventDetailSheetProps) {
  // Wide ±24h window around the clicked event so older operations resolve when
  // opened by URL outside the page's current time filter. Falls back to no
  // bounds if we don't have an anchor timestamp.
  const window = useMemo(() => {
    if (!initialEvent) return { since: undefined, until: undefined };
    const anchor = new Date(initialEvent.timestamp).getTime();
    return {
      since: new Date(anchor - 24 * 60 * 60 * 1000).toISOString(),
      until: new Date(anchor + 24 * 60 * 60 * 1000).toISOString(),
    };
  }, [initialEvent]);

  const fetchKey =
    open && trackingId && metricSlug && projectId
      ? `/v1/projects/${projectId}/metrics/${metricSlug}/events${(() => {
          const qs = buildQueryString({
            tracking_id: trackingId,
            data_mode: dataMode,
            since: window.since,
            until: window.until,
            limit: 20,
          });
          return qs ? `?${qs}` : "";
        })()}`
      : null;

  const { data, isLoading } = useSWR<MetricEventsResponse>(fetchKey);

  const phases = useMemo<StoredMetricEventResponse[]>(() => {
    if (trackingId && data?.events && data.events.length > 0) {
      // Server returns desc by timestamp; show oldest → newest in the lifecycle.
      return [...data.events].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
    }
    if (initialEvent) return [initialEvent];
    return [];
  }, [trackingId, data, initialEvent]);

  const endPhase = phases.find((p) => END_PHASES.includes(p.phase));
  const startPhase = phases.find((p) => p.phase === "start");
  const recordPhase = phases.find((p) => p.phase === "record");

  // Outcome shown in the header: the end phase if present; otherwise "in_progress"
  // for an orphan start; otherwise the single record / fallback to the anchor's phase.
  const outcomePhase: MetricPhase | "in_progress" = endPhase
    ? endPhase.phase
    : startPhase
      ? "in_progress"
      : recordPhase
        ? "record"
        : (phases[0]?.phase ?? "start");
  const outcome = OUTCOME_META[outcomePhase];

  // A representative event for the common-context section. Prefer the end phase
  // (latest device/version snapshot) and fall back through start / record.
  const contextEvent: StoredMetricEventResponse | null =
    endPhase ?? startPhase ?? recordPhase ?? phases[0] ?? initialEvent;

  const totalDurationMs = endPhase?.duration_ms ?? recordPhase?.duration_ms ?? null;
  const headerTimestamp = startPhase?.timestamp ?? phases[0]?.timestamp ?? initialEvent?.timestamp;
  const showLifecycle = phases.length >= 2;

  if (!initialEvent && !data) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[500px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <ProjectDot color={projectColor} />
            <Badge variant="outline" tone={outcome.tone} size="sm">
              {outcome.emoji} {outcome.label}
            </Badge>
            {totalDurationMs != null && (
              <span className="text-xs font-mono text-muted-foreground">
                {formatDuration(totalDurationMs)}
              </span>
            )}
            {headerTimestamp && (
              <span className="text-xs text-muted-foreground">
                {formatDateTime(new Date(headerTimestamp))}
              </span>
            )}
          </div>
          <SheetTitle className="text-base font-medium mt-1 break-words font-mono">
            {metricSlug ?? "—"}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0 px-6 pb-6">
          {/* Lifecycle: one block per phase */}
          {showLifecycle ? (
            <div className="space-y-3">
              {phases.map((p, idx) => (
                <PhaseBlock key={`${p.id}-${idx}`} phase={p} />
              ))}
            </div>
          ) : phases.length === 1 ? (
            <div className="space-y-3">
              <PhaseBlock phase={phases[0]} />
            </div>
          ) : trackingId && isLoading ? (
            <p className="text-xs text-muted-foreground">Loading operation…</p>
          ) : trackingId ? (
            <p className="text-xs text-muted-foreground">
              Operation not found in this time window.
            </p>
          ) : null}

          {contextEvent && (
            <>
              <Separator className="my-4" />
              <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Context
              </h3>
              <div className="space-y-1">
                <DetailRow
                  label="Tracking ID"
                  value={contextEvent.tracking_id}
                  onFilter={
                    onFilter && contextEvent.tracking_id
                      ? () => onFilter("tracking_id", contextEvent.tracking_id!)
                      : undefined
                  }
                />
                <DetailRow label="Metric Slug" value={contextEvent.metric_slug} />
                <DetailRow label="App ID" value={contextEvent.app_id} />
                <DetailRow
                  label="User ID"
                  value={contextEvent.user_id}
                  onFilter={
                    onFilter && contextEvent.user_id
                      ? () => onFilter("user_id", contextEvent.user_id!)
                      : undefined
                  }
                />
                <DetailRow label="Session ID" value={contextEvent.session_id} />
                <DetailRow
                  label="Environment"
                  value={contextEvent.environment}
                  onFilter={
                    onFilter && contextEvent.environment
                      ? () => onFilter("environment", contextEvent.environment!)
                      : undefined
                  }
                />
                <DetailRow label="OS Version" value={contextEvent.os_version} />
                <VersionRow
                  label="App Version"
                  version={contextEvent.app_version}
                  latestVersion={latestAppVersion}
                />
                <DetailRow
                  label="SDK"
                  value={
                    formatSdkLabel(contextEvent.sdk_name, contextEvent.sdk_version) || null
                  }
                />
                <DetailRow label="Build Number" value={contextEvent.build_number} />
                <DetailRow label="Device Model" value={contextEvent.device_model} />
                {(() => {
                  const f = countryFlag(contextEvent.country_code);
                  return (
                    <DetailRow
                      label="Country"
                      value={f.emoji ? `${f.emoji} ${f.name} (${f.code})` : null}
                    />
                  );
                })()}
                {contextEvent.is_dev && (
                  <div className="flex justify-between gap-4 py-1.5">
                    <span className="shrink-0 text-xs text-muted-foreground">
                      🛠️ Dev Build
                    </span>
                    <span className="text-right text-xs font-medium text-yellow-600">
                      Yes
                    </span>
                  </div>
                )}
              </div>

              {contextEvent.app_id && contextEvent.user_id && (
                <>
                  <Separator className="my-4" />
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <Link
                      href={`/dashboard/users?app_id=${contextEvent.app_id}&app_user_id=${contextEvent.user_id}&sort=first_seen`}
                    >
                      <ArrowRight className="h-3.5 w-3.5 mr-2" />
                      View User
                    </Link>
                  </Button>
                </>
              )}
            </>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function PhaseBlock({ phase }: { phase: StoredMetricEventResponse }) {
  const ts = new Date(phase.timestamp);
  const attrs = phase.attributes ?? null;
  return (
    <div className="rounded-md border bg-card/30 p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          <MetricPhaseBadge phase={phase.phase} />
          <span className="text-xs font-mono text-muted-foreground">
            {formatDateTime(ts)}
          </span>
        </div>
        {phase.duration_ms != null && (
          <span className="text-xs font-mono">{formatDuration(phase.duration_ms)}</span>
        )}
      </div>
      {phase.error && (
        <p className="text-xs text-red-500 break-words mb-2">{phase.error}</p>
      )}
      {attrs && Object.keys(attrs).length > 0 && (
        <div className="space-y-1">
          {Object.entries(attrs).map(([k, v]) => (
            <DetailRow key={k} label={k} value={v} />
          ))}
        </div>
      )}
    </div>
  );
}
