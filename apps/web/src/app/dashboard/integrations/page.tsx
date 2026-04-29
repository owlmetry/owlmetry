"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { ProjectResponse } from "@owlmetry/shared";
import { useTeam } from "@/contexts/team-context";
import { useLastSelectedProject } from "@/hooks/use-last-selected-project";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RevenueCatIntegration } from "@/components/revenuecat-integration";
import { AppleSearchAdsIntegration } from "@/components/apple-search-ads-integration";
import { AppStoreConnectIntegration } from "@/components/app-store-connect-integration";
import { ProjectDot } from "@/lib/project-color";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";

export default function IntegrationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id;

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null
  );
  const projects = projectsData?.projects ?? [];
  const lastProject = useLastSelectedProject(teamId);

  const [projectId, setProjectIdState] = useState(searchParams.get("project_id") ?? "");
  function setProjectId(id: string) {
    setProjectIdState(id);
    lastProject.write(id);
    const params = new URLSearchParams();
    if (id) params.set("project_id", id);
    const qs = params.toString();
    router.replace(`/dashboard/integrations${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  const stored = lastProject.read();
  const storedValid = stored ? projects.some((p) => p.id === stored) : false;
  const selectedProjectId =
    projectId ||
    (storedValid ? stored! : "") ||
    projects[0]?.id ||
    "";

  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== stored) {
      lastProject.write(selectedProjectId);
    }
  }, [selectedProjectId, stored, lastProject]);

  return (
    <AnimatedPage className="space-y-6">
      <StaggerItem index={0}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Project</label>
              <Select value={selectedProjectId} onValueChange={setProjectId}>
                <SelectTrigger className="w-[220px] h-8 text-xs">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
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
          </div>
        </div>
      </StaggerItem>

      <StaggerItem index={1}>
        {selectedProjectId ? (
          <div className="space-y-4 max-w-3xl">
            <RevenueCatIntegration projectId={selectedProjectId} />
            <AppleSearchAdsIntegration projectId={selectedProjectId} />
            <AppStoreConnectIntegration projectId={selectedProjectId} />
          </div>
        ) : (
          <p className="text-muted-foreground">Select a project to view integrations.</p>
        )}
      </StaggerItem>
    </AnimatedPage>
  );
}
