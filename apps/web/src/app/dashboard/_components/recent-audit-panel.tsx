"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import type { AuditLogsQueryParams } from "@owlmetry/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditLogs } from "@/hooks/use-audit-logs";
import { useTeam } from "@/contexts/team-context";
import { AuditActionBadge } from "@/components/badges/audit-action-badge";
import { DashboardSection } from "./dashboard-section";
import { EmptyState } from "./empty-state";
import { timeAgo } from "./time-ago";

export function RecentAuditPanel() {
  const { currentTeam, currentRole } = useTeam();
  const teamId = currentTeam?.id;

  const filters: AuditLogsQueryParams = { limit: 5 };
  const isAdmin = currentRole === "owner" || currentRole === "admin";
  const { auditLogs, isLoading } = useAuditLogs(isAdmin ? teamId : undefined, filters);

  if (!isAdmin) return null;

  return (
    <DashboardSection eyebrow="Trail" title="Recent Activity" viewAllHref="/dashboard/audit-log">
      {isLoading ? (
        <SkeletonRows />
      ) : auditLogs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No recent activity"
          subtitle="Creates, updates, and deletes will appear here."
        />
      ) : (
        auditLogs.slice(0, 5).map((log) => {
          const resource = log.resource_type.replace(/_/g, " ");
          return (
            <Link
              key={log.id}
              href="/dashboard/audit-log"
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="shrink-0 w-[72px] flex justify-start">
                <AuditActionBadge action={log.action} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">
                  <span className="font-medium">{resource}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {log.resource_id.slice(0, 8)}…
                  </span>
                </p>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {log.actor_type === "agent" ? "🕶️ agent" : "👤 user"}
                </div>
              </div>
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                {timeAgo(log.timestamp)}
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
          <Skeleton className="h-5 w-16" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </>
  );
}
