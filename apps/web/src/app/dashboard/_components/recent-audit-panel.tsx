"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import type { AuditLogsQueryParams } from "@owlmetry/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditLogs } from "@/hooks/use-audit-logs";
import { useTeam } from "@/contexts/team-context";
import { DashboardSection } from "./dashboard-section";
import { EmptyState } from "./empty-state";
import { timeAgo } from "./time-ago";

function actionMeta(action: string): { emoji: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  switch (action) {
    case "create": return { emoji: "✨", variant: "default" };
    case "update": return { emoji: "✏️", variant: "secondary" };
    case "delete": return { emoji: "🗑️", variant: "destructive" };
    default: return { emoji: "•", variant: "outline" };
  }
}

export function RecentAuditPanel() {
  const { currentTeam, currentRole } = useTeam();
  const teamId = currentTeam?.id;

  const filters: AuditLogsQueryParams = { limit: 5 };
  const isAdmin = currentRole === "owner" || currentRole === "admin";
  const { auditLogs, isLoading } = useAuditLogs(isAdmin ? teamId : undefined, filters);

  if (!isAdmin) return null;

  return (
    <DashboardSection title="Recent Activity" viewAllHref="/dashboard/audit-log">
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
          const meta = actionMeta(log.action);
          const resource = log.resource_type.replace(/_/g, " ");
          return (
            <Link
              key={log.id}
              href="/dashboard/audit-log"
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <Badge variant={meta.variant} className="text-[10px] h-5 shrink-0">
                {meta.emoji} {log.action}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">
                  <span className="font-medium">{resource}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {log.resource_id.slice(0, 8)}…
                  </span>
                </p>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{timeAgo(log.timestamp)}</span>
                  <span>·</span>
                  <span>{log.actor_type === "agent" ? "🕶️ agent" : "👤 user"}</span>
                </div>
              </div>
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
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </>
  );
}
