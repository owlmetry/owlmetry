"use client";

import Link from "next/link";
import type { QuestionnaireSpec } from "@owlmetry/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectDot } from "@/lib/project-color";
import { StaggerItem } from "@/components/ui/animated-page";
import { formatDateTime } from "@/lib/format-date";

interface QuestionnaireCardGridProps {
  questionnaires: QuestionnaireSpec[];
  projectColors: Map<string, string>;
  /**
   * When true, the per-card project dot is hidden (the parent already shows
   * project identity in its section header). Single-project view keeps it on.
   */
  hideProjectDot?: boolean;
  startIndex?: number;
}

export function QuestionnaireCardGrid({
  questionnaires,
  projectColors,
  hideProjectDot = false,
  startIndex = 0,
}: QuestionnaireCardGridProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {questionnaires.map((q, idx) => (
        <StaggerItem key={q.id} index={startIndex + idx}>
          <Link href={`/dashboard/questionnaires/${q.id}?project_id=${q.project_id}`}>
            <Card className="hover:border-primary/30 transition-colors h-full">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2 min-w-0">
                    {!hideProjectDot && (
                      <ProjectDot color={projectColors.get(q.project_id) ?? "#6366f1"} />
                    )}
                    <span className="truncate">{q.name}</span>
                  </span>
                  <span
                    className={
                      q.is_active
                        ? "text-xs font-normal text-emerald-600 dark:text-emerald-400"
                        : "text-xs font-normal text-muted-foreground"
                    }
                  >
                    {q.is_active ? "active" : "paused"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <div>
                  <code className="text-foreground">{q.slug}</code>
                </div>
                <div>
                  <span className="text-foreground">{q.response_count ?? 0}</span>{" "}
                  response{q.response_count === 1 ? "" : "s"}
                </div>
                {q.last_response_at && (
                  <div className="text-xs">
                    Last: {formatDateTime(q.last_response_at)}
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        </StaggerItem>
      ))}
    </div>
  );
}
