"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { ProjectResponse, QuestionnaireSchema } from "@owlmetry/shared";
import { useTeam } from "@/contexts/team-context";
import { useQuestionnaires, questionnaireActions } from "@/hooks/use-questionnaires";
import { useProjectColorMap } from "@/hooks/use-project-colors";
import { formatDateTime } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ListChecks, Plus } from "lucide-react";
import { ProjectDot } from "@/lib/project-color";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";

const SAMPLE_SCHEMA: QuestionnaireSchema = {
  version: 1,
  questions: [
    {
      id: "q_overall",
      type: "rating",
      title: "How would you rate the app overall?",
      required: true,
      scale: 5,
    },
    {
      id: "q_nps",
      type: "nps",
      title: "How likely are you to recommend us to a friend?",
      required: false,
    },
    {
      id: "q_feedback",
      type: "text",
      title: "Anything you'd like to share?",
      required: false,
      multiline: true,
      placeholder: "Optional",
    },
  ],
};

export default function QuestionnairesPage() {
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id;

  const { data: projects } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null,
  );
  const projectColors = useProjectColorMap(teamId);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const projectsList = projects?.projects ?? [];
  const activeProjectId = selectedProjectId || projectsList[0]?.id;

  const { questionnaires, isLoading, mutate } = useQuestionnaires(activeProjectId);

  return (
    <AnimatedPage>
      <div className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ListChecks className="h-6 w-6" />
              Questionnaires
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              In-app structured surveys. Multi-question, configurable trigger from the SDK.
            </p>
          </div>
          <CreateQuestionnaireDialog
            projectId={activeProjectId}
            onCreated={() => mutate()}
          />
        </div>

        {projectsList.length > 1 && (
          <div className="flex items-center gap-2">
            <Label className="text-sm">Project:</Label>
            <Select
              value={activeProjectId ?? ""}
              onValueChange={setSelectedProjectId}
            >
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projectsList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : questionnaires.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <ListChecks className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">
                No questionnaires yet. Create one above and reference it from your SDK code with{" "}
                <code className="text-foreground">.owlQuestionnaire(slug:&hellip;)</code>.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {questionnaires.map((q, idx) => (
              <StaggerItem key={q.id} index={idx}>
                <Link href={`/dashboard/questionnaires/${q.id}`}>
                  <Card className="hover:border-primary/30 transition-colors h-full">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between gap-2 text-base">
                        <span className="flex items-center gap-2 min-w-0">
                          <ProjectDot color={projectColors.get(q.project_id) ?? "#6366f1"} />
                          <span className="truncate">{q.name}</span>
                        </span>
                        <span
                          className={
                            q.is_active
                              ? "text-xs font-normal text-emerald-600 dark:text-emerald-400"
                              : "text-xs font-normal text-muted-foreground"
                          }
                        >
                          {q.is_active ? "active" : "paused"}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm text-muted-foreground">
                      <div>
                        <code className="text-foreground">{q.slug}</code>
                      </div>
                      <div>
                        <span className="text-foreground">{q.response_count ?? 0}</span>{" "}
                        response{q.response_count === 1 ? "" : "s"}
                      </div>
                      {q.last_response_at && (
                        <div className="text-xs">
                          Last: {formatDateTime(q.last_response_at)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              </StaggerItem>
            ))}
          </div>
        )}
      </div>
    </AnimatedPage>
  );
}

function CreateQuestionnaireDialog({
  projectId,
  onCreated,
}: {
  projectId: string | undefined;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schemaText, setSchemaText] = useState(JSON.stringify(SAMPLE_SCHEMA, null, 2));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!projectId) return;
    setError(null);
    let parsed: QuestionnaireSchema;
    try {
      parsed = JSON.parse(schemaText);
    } catch (e) {
      setError("Schema is not valid JSON");
      return;
    }
    setSubmitting(true);
    try {
      await questionnaireActions.create(projectId, {
        slug,
        name,
        description: description.trim() === "" ? null : description,
        schema: parsed,
      });
      setOpen(false);
      setSlug("");
      setName("");
      setDescription("");
      setSchemaText(JSON.stringify(SAMPLE_SCHEMA, null, 2));
      onCreated();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-1" />
          New questionnaire
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create questionnaire</DialogTitle>
          <DialogDescription>
            Slug is immutable after creation — the SDK references it directly via{" "}
            <code>.owlQuestionnaire(slug: &quot;&hellip;&quot;)</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qs-slug">Slug</Label>
              <Input
                id="qs-slug"
                placeholder="post-onboarding"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="qs-name">Name</Label>
              <Input
                id="qs-name"
                placeholder="Onboarding survey"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="qs-description">Description (optional)</Label>
            <Input
              id="qs-description"
              placeholder="Short context shown above the questions"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="qs-schema">Schema (JSON)</Label>
            <textarea
              id="qs-schema"
              className="w-full h-64 font-mono text-xs rounded-md border border-input bg-background px-3 py-2 mt-1"
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !slug || !name}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
