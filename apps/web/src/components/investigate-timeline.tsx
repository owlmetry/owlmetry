"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { levelColors } from "@/lib/level-colors";
import { cn } from "@/lib/utils";
import type { EventsResponse, StoredEventResponse, LogLevel } from "@owlmetry/shared";

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

    const ts = new Date(event.timestamp);
    const since = new Date(ts.getTime() - 5 * 60 * 1000).toISOString();
    const until = new Date(ts.getTime() + 5 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
      app_id: event.app_id,
      since,
      until,
      limit: "200",
    });
    if (event.user_id) params.set("user_id", event.user_id);
    params.set("data_mode", "all");

    api
      .get<EventsResponse>(`/v1/events?${params}`)
      .then((res) => {
        if (!cancelled) setEvents(res.events);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Failed to load timeline");
      });

    return () => { cancelled = true; };
  }, [event.id, event.app_id, event.user_id, event.timestamp]);

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
        Timeline ({events.length} events, ±5 min)
      </h3>
      <div className="space-y-0.5">
        {events.map((e) => {
          const isTarget = e.id === event.id;
          const ts = new Date(e.timestamp);
          const time = ts.toLocaleTimeString("en-US", { hour12: false });
          const colors = levelColors[e.level as LogLevel];

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
