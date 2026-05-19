"use client";

import { ProjectDot } from "@/lib/project-color";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { ProjectResponse } from "@owlmetry/shared";

export const ALL_PROJECTS = "__all__";

interface QuestionnairesFilterBarProps {
  projects: ProjectResponse[];
  projectId: string;
  hideInactive: boolean;
  onProjectChange: (id: string) => void;
  onHideInactiveChange: (hide: boolean) => void;
}

export function QuestionnairesFilterBar({
  projects,
  projectId,
  hideInactive,
  onProjectChange,
  onHideInactiveChange,
}: QuestionnairesFilterBarProps) {
  return (
    <div className="flex items-end gap-4 flex-wrap">
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

      <label className="flex items-center gap-2 text-xs pb-1.5 cursor-pointer select-none">
        <Checkbox
          checked={hideInactive}
          onCheckedChange={(v) => onHideInactiveChange(v === true)}
        />
        Hide inactive
      </label>
    </div>
  );
}
