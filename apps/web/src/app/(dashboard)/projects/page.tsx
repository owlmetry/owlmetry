"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { useUser } from "@/hooks/use-user";

interface Project {
  id: string;
  team_id: string;
  name: string;
  slug: string;
  created_at: string;
  deleted_at: string | null;
}

export default function ProjectsPage() {
  const { teams } = useUser();
  const { data, mutate } = useSWR<{ projects: Project[] }>("/v1/projects");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const projects = data?.projects ?? [];
  const defaultTeamId = teams?.[0]?.id;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!defaultTeamId) return;
    setError("");
    setLoading(true);

    try {
      await api.post("/v1/projects", { name, team_id: defaultTeamId });
      setName("");
      setShowCreate(false);
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
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleCreate} className="flex items-end gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  placeholder="My App"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </form>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}

      {projects.length === 0 ? (
        <p className="text-muted-foreground">No projects yet. Create one to get started.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="transition-colors hover:border-primary/50">
                <CardHeader>
                  <CardTitle>{project.name}</CardTitle>
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
