"use client";

import { ProjectDot } from "@/lib/project-color";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProjectResponse, AppResponse } from "@owlmetry/shared";
import { ADS_ATTRIBUTION_SOURCES } from "@owlmetry/shared/attribution";

const SOURCE_LABELS: Record<string, string> = {
  apple_search_ads: "Apple Search Ads",
};

export const ALL_PROJECTS = "__all__";

interface AdsFilterBarProps {
  projects: ProjectResponse[];
  apps: AppResponse[];
  projectId: string;
  appId: string | null;
  attributionSource: string;
  onProjectChange: (id: string) => void;
  onAppChange: (id: string | null) => void;
  onAttributionSourceChange: (source: string) => void;
}

const ALL_APPS = "__all_apps__";

export function AdsFilterBar({
  projects,
  apps,
  projectId,
  appId,
  attributionSource,
  onProjectChange,
  onAppChange,
  onAttributionSourceChange,
}: AdsFilterBarProps) {
  const isAllProjects = projectId === ALL_PROJECTS;
  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Project</label>
        <Select value={projectId} onValueChange={onProjectChange}>
          <SelectTrigger className="w-[220px] h-8 text-xs">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-2">
                  <ProjectDot color={p.color} />
                  {p.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isAllProjects && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">App</label>
          <Select
            value={appId ?? ALL_APPS}
            onValueChange={(v) => onAppChange(v === ALL_APPS ? null : v)}
          >
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="All apps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_APPS}>All apps</SelectItem>
              {apps.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Source</label>
        <Select value={attributionSource} onValueChange={onAttributionSourceChange}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADS_ATTRIBUTION_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {SOURCE_LABELS[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
