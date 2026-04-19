"use client";

import Link from "next/link";
import { useMemo } from "react";
import useSWR from "swr";
import { ScrollText } from "lucide-react";
import type { AppResponse, LogLevel, ProjectResponse } from "@owlmetry/shared";
import { EventLevelBadge } from "@/components/event-level-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectDot } from "@/lib/project-color";
import { useEvents } from "@/hooks/use-events";
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import { DashboardSection } from "./dashboard-section";
import { EmptyState } from "./empty-state";
import { timeAgo } from "./time-ago";

export function RecentEventsPanel() {
  const { currentTeam } = useTeam();
  const { dataMode } = useDataMode();
  const teamId = currentTeam?.id;

  const { events, isLoading } = useEvents({
    team_id: teamId,
    data_mode: dataMode,
    limit: 20,
  });

  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    teamId ? `/v1/apps?team_id=${teamId}` : null
  );
  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null
  );

  const appMeta = useMemo(() => {
    const projectColors = new Map<string, string>();
    for (const p of projectsData?.projects ?? []) projectColors.set(p.id, p.color);
    const map = new Map<string, { name: string; projectColor: string | undefined }>();
    for (const a of appsData?.apps ?? []) {
      map.set(a.id, { name: a.name, projectColor: projectColors.get(a.project_id) });
    }
    return map;
  }, [appsData, projectsData]);

  const visible = events.filter((e) => e.level !== "debug").slice(0, 5);

  return (
    <DashboardSection eyebrow="Stream" title="Recent Events" viewAllHref="/dashboard/events">
      {isLoading && !events.length ? (
        <SkeletonRows />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No events yet"
          subtitle="Install an SDK to start receiving events."
          ctaLabel="Installation guide"
          ctaHref="/docs/sdks"
        />
      ) : (
        visible.map((event) => {
          const meta = appMeta.get(event.app_id);
          return (
            <Link
              key={event.id}
              href="/dashboard/events"
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="shrink-0 w-16 flex justify-start">
                <EventLevelBadge level={event.level as LogLevel} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono truncate">{event.message}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  {meta && (
                    <span className="flex items-center gap-1 truncate">
                      <ProjectDot color={meta.projectColor} size={5} />
                      <span className="truncate max-w-[140px]">{meta.name}</span>
                    </span>
                  )}
                  {event.environment && (
                    <>
                      <span>·</span>
                      <span>{event.environment}</span>
                    </>
                  )}
                </div>
              </div>
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                {timeAgo(event.timestamp)}
              </span>
            </Link>
          );
        })
      )}
    </DashboardSection>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Skeleton className="h-5 w-14" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </>
  );
}
