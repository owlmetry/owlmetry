"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { levelColors } from "@/lib/level-colors";
import { cn } from "@/lib/utils";
import type { EventsResponse, StoredEventResponse, LogLevel } from "@owlmetry/shared";
import { formatShortDate, formatTime } from "@/lib/format-date";
import { countryFlag } from "@/lib/country-flag";

interface InvestigateTimelineProps {
  event: StoredEventResponse;
  onEventSelect: (event: StoredEventResponse) => void;
}

export function InvestigateTimeline({ event, onEventSelect }: InvestigateTimelineProps) {
  const [events, setEvents] = useState<StoredEventResponse[] | null>(null);
  const [error, setError] = useState("");
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError("");

    (async () => {
      try {
        // Fetch fresh target to get project_id (not returned on list queries).
        const target = await api.get<StoredEventResponse>(`/v1/events/${event.id}`);
        if (cancelled) return;

        const targetMs = new Date(target.timestamp).getTime();

        // Phase A: full session (same app) or ±5 min fallback.
        const phaseAParams = new URLSearchParams({
          app_id: target.app_id,
          limit: "1000",
          data_mode: "all",
        });
        if (target.session_id) {
          phaseAParams.set("session_id", target.session_id);
        } else {
          phaseAParams.set("since", new Date(targetMs - 5 * 60 * 1000).toISOString());
          phaseAParams.set("until", new Date(targetMs + 5 * 60 * 1000).toISOString());
          if (target.user_id) phaseAParams.set("user_id", target.user_id);
        }
        const phaseA = await api.get<EventsResponse>(`/v1/events?${phaseAParams}`);
        if (cancelled) return;

        // Phase B: project-wide events for the same user, bounded by Phase A's time range.
        let phaseBEvents: StoredEventResponse[] = [];
        if (target.user_id && target.project_id) {
          const timestamps = phaseA.events
            .map((e) => new Date(e.timestamp).getTime())
            .filter((n) => Number.isFinite(n));
          const earliestMs = timestamps.length ? Math.min(...timestamps, targetMs) : targetMs;
          const latestMs = timestamps.length ? Math.max(...timestamps, targetMs) : targetMs;

          const phaseBParams = new URLSearchParams({
            project_id: target.project_id,
            user_id: target.user_id,
            since: new Date(earliestMs).toISOString(),
            until: new Date(latestMs).toISOString(),
            limit: "1000",
            data_mode: "all",
          });
          const phaseB = await api.get<EventsResponse>(`/v1/events?${phaseBParams}`);
          if (cancelled) return;
          phaseBEvents = phaseB.events;
        }

        // Merge target + Phase A + Phase B, dedupe by id, sort ascending by timestamp.
        const byId = new Map<string, StoredEventResponse>();
        for (const e of [target, ...phaseA.events, ...phaseBEvents]) {
          if (!byId.has(e.id)) byId.set(e.id, e);
        }
        const merged = Array.from(byId.values()).sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );

        if (!cancelled) setEvents(merged);
      } catch (err) {
        if (!cancelled) setError((err as Error).message ?? "Failed to load timeline");
      }
    })();

    return () => { cancelled = true; };
  }, [event.id]);

  // Auto-scroll to target event
  useEffect(() => {
    if (events && targetRef.current) {
      targetRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [events]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!events) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Timeline
        </h3>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Timeline ({events.length} events)
      </h3>
      <div className="space-y-0.5">
        {events.map((e) => {
          const isTarget = e.id === event.id;
          const ts = new Date(e.timestamp);
          const date = formatShortDate(ts);
          const time = `${formatTime(ts)} ${date}`;
          const colors = levelColors[e.level as LogLevel];
          const flag = countryFlag(e.country_code);

          return (
            <div
              key={e.id}
              ref={isTarget ? targetRef : undefined}
              onClick={() => onEventSelect(e)}
              className={cn(
                "flex items-baseline gap-2 px-2 py-0.5 rounded cursor-pointer text-xs font-mono hover:bg-muted/50 transition-colors",
                isTarget && "bg-primary/10 font-bold"
              )}
            >
              <span className="shrink-0 text-muted-foreground">{time}</span>
              {flag.emoji ? (
                <span className="shrink-0" title={`${flag.name} (${flag.code})`}>
                  {flag.emoji}
                </span>
              ) : (
                <span className="shrink-0 w-4" />
              )}
              <span className={cn("shrink-0 uppercase w-12", colors.text)}>
                {e.level.slice(0, 5).padEnd(5)}
              </span>
              <span className="truncate">{e.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
