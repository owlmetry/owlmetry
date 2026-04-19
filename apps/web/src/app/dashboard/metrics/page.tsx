"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { ProjectResponse } from "@owlmetry/shared";

const SLUG_REGEX = /^[a-z0-9-]+$/;
function validateMetricSlug(slug: string): string | null {
  if (!slug) return "metric slug is required";
  if (!SLUG_REGEX.test(slug)) {
    return "metric slug must contain only lowercase letters, numbers, and hyphens";
  }
  return null;
}
import { useTeam } from "@/contexts/team-context";
import { useMetricDefinitions } from "@/hooks/use-metrics";
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
import { BarChart3, Plus } from "lucide-react";

export default function MetricsPage() {
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
    router.replace(`/dashboard/metrics${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  const selectedProjectId = projectId || projects[0]?.id || "";
  const { metrics, isLoading, mutate } = useMetricDefinitions(selectedProjectId || undefined);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isLifecycle, setIsLifecycle] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const slugError = newSlug ? validateMetricSlug(newSlug) : null;

  async function handleCreate() {
    if (!newName || !newSlug || !selectedProjectId || slugError) return;
    setCreating(true);
    setCreateError("");
    try {
      await api.post(`/v1/projects/${selectedProjectId}/metrics`, {
        name: newName,
        slug: newSlug,
        description: newDescription || undefined,
        aggregation_rules: isLifecycle ? { lifecycle: true } : undefined,
      });
      setCreateOpen(false);
      setNewName("");
      setNewSlug("");
      setNewDescription("");
      setIsLifecycle(false);
      mutate();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create metric");
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
                      <ProjectDot color={p.color} />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={!selectedProjectId}>
              <Plus className="h-4 w-4 mr-1" />
              New Metric
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Metric Definition</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
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
              <Button onClick={handleCreate} disabled={creating || !newName || !newSlug || !!slugError}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!selectedProjectId ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">Select a project to view metrics</p>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading metrics...</p>
      ) : metrics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <BarChart3 className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">No metrics defined yet</p>
          <p className="text-xs mt-1">Create a metric definition to start tracking</p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => (
            <Card
              key={m.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() =>
                router.push(`/dashboard/metrics/${m.id}`)
              }
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{m.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground font-mono">{m.slug}</p>
                {m.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
