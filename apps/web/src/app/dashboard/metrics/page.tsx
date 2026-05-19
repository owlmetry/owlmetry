"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type {
  MetricDefinitionResponse,
  MetricStatsEntry,
  ProjectResponse,
} from "@owlmetry/shared";

const SLUG_REGEX = /^[a-z0-9-]+$/;
function validateMetricSlug(slug: string): string | null {
  if (!slug) return "metric slug is required";
  if (!SLUG_REGEX.test(slug)) {
    return "metric slug must contain only lowercase letters, numbers, and hyphens";
  }
  return null;
}
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import {
  useMetricDefinitions,
  useMetricStats,
  useTeamMetricDefinitions,
  useTeamMetricStats,
} from "@/hooks/use-metrics";
import { useProjectColorMap, useProjectInfoMap } from "@/hooks/use-project-colors";
import { ProjectDot } from "@/lib/project-color";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BarChart3, Plus } from "lucide-react";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { CardGridSkeleton } from "@/components/ui/skeletons";
import {
  MetricsFilterBar,
  ALL_PROJECTS,
} from "./_components/metrics-filter-bar";
import { MetricCardGrid } from "./_components/metric-card-grid";
import {
  ProjectMetricsSection,
  bucketByProject,
} from "./_components/project-metrics-section";

export default function MetricsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id;
  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null
  );
  const projects = projectsData?.projects ?? [];
  const projectInfoMap = useProjectInfoMap(teamId);
  const projectColors = useProjectColorMap(teamId);

  const [projectId, setProjectIdState] = useState<string>(
    searchParams.get("project_id") ?? ALL_PROJECTS,
  );
  const isAllProjects = projectId === ALL_PROJECTS;

  function setProjectId(v: string) {
    setProjectIdState(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v === ALL_PROJECTS) params.delete("project_id");
    else params.set("project_id", v);
    const qs = params.toString();
    router.replace(`/dashboard/metrics${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  const { dataMode } = useDataMode();

  const teamData = useTeamMetricDefinitions(isAllProjects ? teamId : undefined);
  const teamStatsData = useTeamMetricStats(isAllProjects ? teamId : undefined, {
    data_mode: dataMode,
  });
  const projectData = useMetricDefinitions(isAllProjects ? undefined : projectId);
  const projectStatsData = useMetricStats(isAllProjects ? undefined : projectId, {
    data_mode: dataMode,
  });

  const metrics = isAllProjects ? teamData.metrics : projectData.metrics;
  const isLoading = isAllProjects ? teamData.isLoading : projectData.isLoading;
  const mutate = isAllProjects ? teamData.mutate : projectData.mutate;

  const resolveStats = useMemo(() => {
    if (isAllProjects) {
      return (m: MetricDefinitionResponse): MetricStatsEntry | undefined =>
        teamStatsData.statsByProjectSlug.get(`${m.project_id}:${m.slug}`);
    }
    return (m: MetricDefinitionResponse): MetricStatsEntry | undefined =>
      projectStatsData.statsBySlug.get(m.slug);
  }, [isAllProjects, teamStatsData.statsByProjectSlug, projectStatsData.statsBySlug]);

  const buckets = useMemo(
    () =>
      bucketByProject(
        metrics,
        teamStatsData.statsByProjectSlug,
        (id) => projectInfoMap.get(id)?.name ?? id,
      ),
    [metrics, teamStatsData.statsByProjectSlug, projectInfoMap],
  );

  // Card animation indices need to keep climbing across stacked buckets so the
  // stagger doesn't restart at 0 inside each section.
  let runningIndex = 0;

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
        <div className="flex items-start justify-between gap-4">
          <MetricsFilterBar
            projects={projects}
            projectId={projectId}
            onProjectChange={setProjectId}
          />
          <CreateMetricDialog
            preselectedProjectId={isAllProjects ? undefined : projectId}
            projects={projects}
            onCreated={() => mutate()}
          />
        </div>
      </StaggerItem>

      <StaggerItem index={1}>
        {isLoading ? (
          <CardGridSkeleton cards={6} />
        ) : metrics.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BarChart3 className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">No metrics defined yet</p>
            <p className="text-xs mt-1">Create a metric definition to start tracking</p>
          </div>
        ) : isAllProjects ? (
          <div className="space-y-6">
            {buckets.map((bucket) => {
              const info = projectInfoMap.get(bucket.projectId);
              const sectionStart = runningIndex;
              runningIndex += bucket.items.length;
              return (
                <ProjectMetricsSection
                  key={bucket.projectId}
                  projectName={info?.name ?? bucket.projectId}
                  projectColor={info?.color}
                  bucket={bucket}
                  resolveStats={resolveStats}
                  projectColors={projectColors}
                  startIndex={sectionStart}
                />
              );
            })}
          </div>
        ) : (
          <MetricCardGrid
            metrics={metrics}
            resolveStats={resolveStats}
            projectColors={projectColors}
          />
        )}
      </StaggerItem>
    </AnimatedPage>
  );
}

function CreateMetricDialog({
  preselectedProjectId,
  projects,
  onCreated,
}: {
  preselectedProjectId: string | undefined;
  projects: ProjectResponse[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dialogProjectId, setDialogProjectId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isLifecycle, setIsLifecycle] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const effectiveProjectId = preselectedProjectId ?? dialogProjectId;
  const needsProjectPicker = !preselectedProjectId;
  const slugError = newSlug ? validateMetricSlug(newSlug) : null;

  async function handleCreate() {
    if (!newName || !newSlug || !effectiveProjectId || slugError) return;
    setCreating(true);
    setCreateError("");
    try {
      await api.post(`/v1/projects/${effectiveProjectId}/metrics`, {
        name: newName,
        slug: newSlug,
        description: newDescription || undefined,
        aggregation_rules: isLifecycle ? { lifecycle: true } : undefined,
      });
      setOpen(false);
      setNewName("");
      setNewSlug("");
      setNewDescription("");
      setIsLifecycle(false);
      setDialogProjectId("");
      onCreated();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create metric");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New Metric
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Metric Definition</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {needsProjectPicker && (
            <div className="space-y-1">
              <Label htmlFor="metric-project">Project</Label>
              <Select value={dialogProjectId} onValueChange={setDialogProjectId}>
                <SelectTrigger id="metric-project" className="w-full">
                  <SelectValue placeholder="Pick a project" />
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
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium">Name</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Photo Conversion"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Slug</label>
            <Input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="photo-conversion"
            />
            {slugError && newSlug && (
              <p className="text-xs text-red-500">{slugError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens only
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Description</label>
            <Input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isLifecycle}
              onChange={(e) => setIsLifecycle(e.target.checked)}
              className="rounded border-input"
            />
            Lifecycle metric (start/complete/fail phases)
          </label>
        </div>
        {createError && (
          <p className="text-xs text-red-500">{createError}</p>
        )}
        <DialogFooter>
          <Button
            onClick={handleCreate}
            disabled={creating || !newName || !newSlug || !effectiveProjectId || !!slugError}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
