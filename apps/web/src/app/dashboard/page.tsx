"use client";

import Link from "next/link";
import useSWR from "swr";
import { useUser } from "@/hooks/use-user";
import { useTeam } from "@/contexts/team-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FolderOpen, Plus, ArrowRight, Activity, Plug } from "lucide-react";
import type { ProjectResponse } from "@owlmetry/shared";

export default function DashboardPage() {
  const { user, teams } = useUser();
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id;
  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null
  );

  const teamCount = teams?.length ?? 0;
  const projectCount = projectsData?.projects?.length ?? 0;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {user?.name}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{today}</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Teams
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{teamCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Projects
            </CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{projectCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Status
            </CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-sm font-medium">Operational</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-medium mb-3">Quick Actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/dashboard/projects">
            <Card className="group cursor-pointer transition-all duration-150 hover:border-primary/40 hover:shadow-md">
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">View Projects</p>
                  <p className="text-xs text-muted-foreground">
                    Manage your projects and apps
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-1" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/projects">
            <Card className="group cursor-pointer transition-all duration-150 hover:border-primary/40 hover:shadow-md">
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Plus className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">New Project</p>
                  <p className="text-xs text-muted-foreground">
                    Create a new project to get started
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-1" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/docs/mcp/setup">
            <Card className="group cursor-pointer transition-all duration-150 hover:border-primary/40 hover:shadow-md">
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Plug className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">Setup MCP</p>
                  <p className="text-xs text-muted-foreground">
                    Connect your AI coding agent
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-1" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-lg font-medium mb-3">Recent Activity</h2>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Activity className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              Activity feed coming soon
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Events from your apps will appear here
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
