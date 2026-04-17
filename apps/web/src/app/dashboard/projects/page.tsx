"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { useTeam } from "@/contexts/team-context";
import { useUser } from "@/hooks/use-user";
import { ProjectDot, getProjectColor } from "@/lib/project-color";
import type { ProjectResponse } from "@owlmetry/shared";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function ProjectsPage() {
  const { currentTeam } = useTeam();
  const { isLoading: isUserLoading } = useUser();
  const teamId = currentTeam?.id;
  const { data, mutate } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null
  );
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const projects = data?.projects ?? [];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!teamId) {
      setError("No team available. Please reload the page.");
      return;
    }
    setError("");
    setLoading(true);

    try {
      await api.post("/v1/projects", { name, slug: slugify(name), team_id: teamId });
      setName("");
      setOpen(false);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setName(""); setError(""); } }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Project</DialogTitle>
              <DialogDescription>
                Create a new project to group your apps.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  placeholder="My App"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="submit" disabled={loading || isUserLoading}>
                  {isUserLoading ? "Loading..." : loading ? "Creating..." : "Create Project"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {projects.length === 0 ? (
        <p className="text-muted-foreground">No projects yet. Create one to get started.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/dashboard/projects/${project.id}`}>
              <Card
                className="border-l-4 transition-colors hover:border-primary/50"
                style={{ borderLeftColor: getProjectColor(project.id) }}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ProjectDot projectId={project.id} />
                    <span>{project.name}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{project.slug}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
