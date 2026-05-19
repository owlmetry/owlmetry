"use client";

import Link from "next/link";
import type { FunnelDefinitionResponse } from "@owlmetry/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectDot } from "@/lib/project-color";
import { StaggerItem } from "@/components/ui/animated-page";

interface FunnelCardGridProps {
  funnels: FunnelDefinitionResponse[];
  projectColors: Map<string, string>;
  hideProjectDot?: boolean;
  startIndex?: number;
}

export function FunnelCardGrid({
  funnels,
  projectColors,
  hideProjectDot = false,
  startIndex = 0,
}: FunnelCardGridProps) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {funnels.map((f, idx) => (
        <StaggerItem key={f.id} index={startIndex + idx}>
          <Link href={`/dashboard/funnels/${f.id}`}>
            <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 min-w-0">
                  {!hideProjectDot && (
                    <ProjectDot color={projectColors.get(f.project_id) ?? "#6366f1"} />
                  )}
                  <span className="truncate">{f.name}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground font-mono">{f.slug}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {f.steps.length} step{f.steps.length !== 1 ? "s" : ""}
                </p>
                {f.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {f.description}
                  </p>
                )}
              </CardContent>
            </Card>
          </Link>
        </StaggerItem>
      ))}
    </div>
  );
}
