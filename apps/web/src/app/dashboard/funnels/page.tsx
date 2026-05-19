"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { ProjectResponse, FunnelStep } from "@owlmetry/shared";
import { validateFunnelSlug } from "@owlmetry/shared/constants";
import { useTeam } from "@/contexts/team-context";
import { useFunnels, useTeamFunnels } from "@/hooks/use-funnels";
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
import { Filter, Plus, Trash2 } from "lucide-react";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { CardGridSkeleton } from "@/components/ui/skeletons";
import {
  FunnelsFilterBar,
  ALL_PROJECTS,
} from "./_components/funnels-filter-bar";
import { FunnelCardGrid } from "./_components/funnel-card-grid";
import {
  ProjectFunnelsSection,
  bucketByProject,
} from "./_components/project-funnels-section";

interface StepDraft {
  name: string;
  step_name: string;
  screen_name: string;
}

function emptyStep(): StepDraft {
  return { name: "", step_name: "", screen_name: "" };
}

export default function FunnelsPage() {
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
    router.replace(`/dashboard/funnels${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  const teamData = useTeamFunnels(isAllProjects ? teamId : undefined);
  const projectData = useFunnels(isAllProjects ? null : projectId);

  const funnels = isAllProjects ? teamData.funnels : projectData.funnels;
  const isLoading = isAllProjects ? teamData.isLoading : projectData.isLoading;
  const mutate = isAllProjects ? teamData.mutate : projectData.mutate;

  const buckets = useMemo(
    () => bucketByProject(funnels, (id) => projectInfoMap.get(id)?.name ?? id),
    [funnels, projectInfoMap],
  );

  // Card animation indices need to keep climbing across stacked buckets so the
  // stagger doesn't restart at 0 inside each section.
  let runningIndex = 0;

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
        <div className="flex items-start justify-between gap-4">
          <FunnelsFilterBar
            projects={projects}
            projectId={projectId}
            onProjectChange={setProjectId}
          />
          <CreateFunnelDialog
            preselectedProjectId={isAllProjects ? undefined : projectId}
            projects={projects}
            onCreated={() => mutate()}
          />
        </div>
      </StaggerItem>

      <StaggerItem index={1}>
        {isLoading ? (
          <CardGridSkeleton cards={6} />
        ) : funnels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Filter className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">No funnels defined yet</p>
            <p className="text-xs mt-1">
              Create a funnel to track user conversion flows
            </p>
          </div>
        ) : isAllProjects ? (
          <div className="space-y-6">
            {buckets.map((bucket) => {
              const info = projectInfoMap.get(bucket.projectId);
              const sectionStart = runningIndex;
              runningIndex += bucket.items.length;
              return (
                <ProjectFunnelsSection
                  key={bucket.projectId}
                  projectName={info?.name ?? bucket.projectId}
                  projectColor={info?.color}
                  bucket={bucket}
                  projectColors={projectColors}
                  startIndex={sectionStart}
                />
              );
            })}
          </div>
        ) : (
          <FunnelCardGrid funnels={funnels} projectColors={projectColors} />
        )}
      </StaggerItem>
    </AnimatedPage>
  );
}

function CreateFunnelDialog({
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
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep(), emptyStep()]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const effectiveProjectId = preselectedProjectId ?? dialogProjectId;
  const needsProjectPicker = !preselectedProjectId;
  const slugError = newSlug ? validateFunnelSlug(newSlug) : null;

  function addStep() {
    setSteps((prev) => [...prev, emptyStep()]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function updateStep(index: number, field: keyof StepDraft, value: string) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  }

  function resetCreateForm() {
    setNewName("");
    setNewSlug("");
    setNewDescription("");
    setSteps([emptyStep(), emptyStep()]);
    setCreateError("");
    setDialogProjectId("");
  }

  async function handleCreate() {
    if (!newName || !newSlug || !effectiveProjectId || slugError) return;

    const funnelSteps: FunnelStep[] = steps
      .filter((s) => s.name && (s.step_name || s.screen_name))
      .map((s) => ({
        name: s.name,
        event_filter: {
          ...(s.step_name ? { step_name: s.step_name } : {}),
          ...(s.screen_name ? { screen_name: s.screen_name } : {}),
        },
      }));

    if (funnelSteps.length === 0) {
      setCreateError("At least one step with a name and filter is required");
      return;
    }

    setCreating(true);
    setCreateError("");
    try {
      await api.post(`/v1/projects/${effectiveProjectId}/funnels`, {
        name: newName,
        slug: newSlug,
        description: newDescription || undefined,
        steps: funnelSteps,
      });
      setOpen(false);
      resetCreateForm();
      onCreated();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create funnel");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetCreateForm();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New Funnel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Funnel</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {needsProjectPicker && (
            <div className="space-y-1">
              <Label htmlFor="funnel-project">Project</Label>
              <Select value={dialogProjectId} onValueChange={setDialogProjectId}>
                <SelectTrigger id="funnel-project" className="w-full">
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
              placeholder="Onboarding Flow"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Slug</label>
            <Input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="onboarding-flow"
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

          {/* Steps builder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Steps</label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={addStep}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Step
              </Button>
            </div>
            {steps.map((step, i) => (
              <div
                key={i}
                className="border rounded-md p-3 space-y-2 relative"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-medium">
                    Step {i + 1}
                  </span>
                  {steps.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => removeStep(i)}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  )}
                </div>
                <Input
                  value={step.name}
                  onChange={(e) => updateStep(i, "name", e.target.value)}
                  placeholder="Step name"
                  className="h-7 text-xs"
                />
                <Input
                  value={step.step_name}
                  onChange={(e) => updateStep(i, "step_name", e.target.value)}
                  placeholder="Step name (e.g. welcome-screen)"
                  className="h-7 text-xs"
                />
                <Input
                  value={step.screen_name}
                  onChange={(e) =>
                    updateStep(i, "screen_name", e.target.value)
                  }
                  placeholder="Screen name filter (optional)"
                  className="h-7 text-xs"
                />
              </div>
            ))}
          </div>
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
