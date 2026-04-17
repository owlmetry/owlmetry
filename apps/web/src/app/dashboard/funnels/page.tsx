"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { ProjectResponse, FunnelStep } from "@owlmetry/shared";
import { validateFunnelSlug } from "@owlmetry/shared/constants";
import { useTeam } from "@/contexts/team-context";
import { useFunnels } from "@/hooks/use-funnels";
import { ProjectDot } from "@/lib/project-color";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

  const [projectId, setProjectIdState] = useState(searchParams.get("project_id") ?? "");

  function setProjectId(id: string) {
    setProjectIdState(id);
    const params = new URLSearchParams();
    if (id) params.set("project_id", id);
    const qs = params.toString();
    router.replace(`/dashboard/funnels${qs ? `?${qs}` : ""}`, { scroll: false });
  }
  const selectedProjectId = projectId || projects[0]?.id || "";
  const { funnels, isLoading, mutate } = useFunnels(selectedProjectId || null);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep(), emptyStep()]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

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
  }

  async function handleCreate() {
    if (!newName || !newSlug || !selectedProjectId || slugError) return;

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
      await api.post(`/v1/projects/${selectedProjectId}/funnels`, {
        name: newName,
        slug: newSlug,
        description: newDescription || undefined,
        steps: funnelSteps,
      });
      setCreateOpen(false);
      resetCreateForm();
      mutate();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create funnel");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
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
                      <ProjectDot projectId={p.id} />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) resetCreateForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" disabled={!selectedProjectId}>
              <Plus className="h-4 w-4 mr-1" />
              New Funnel
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Funnel</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
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
                disabled={creating || !newName || !newSlug || !!slugError}
              >
                {creating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!selectedProjectId ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">Select a project to view funnels</p>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading funnels...</p>
      ) : funnels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Filter className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">No funnels defined yet</p>
          <p className="text-xs mt-1">
            Create a funnel to track user conversion flows
          </p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {funnels.map((f) => (
            <Card
              key={f.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() =>
                router.push(`/dashboard/funnels/${f.id}`)
              }
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{f.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground font-mono">
                  {f.slug}
                </p>
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
          ))}
        </div>
      )}
    </div>
  );
}
