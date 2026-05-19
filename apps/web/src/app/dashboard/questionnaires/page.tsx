"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { ProjectResponse, QuestionnaireSchema } from "@owlmetry/shared";
import { useTeam } from "@/contexts/team-context";
import {
  useQuestionnaires,
  useTeamQuestionnaires,
  questionnaireActions,
} from "@/hooks/use-questionnaires";
import { useProjectColorMap, useProjectInfoMap } from "@/hooks/use-project-colors";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { AnimatedPage } from "@/components/ui/animated-page";
import {
  QuestionnairesFilterBar,
  ALL_PROJECTS,
} from "./_components/questionnaires-filter-bar";
import { QuestionnaireCardGrid } from "./_components/questionnaire-card-grid";
import {
  ProjectQuestionnairesSection,
  bucketByProject,
} from "./_components/project-questionnaires-section";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id;

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null,
  );
  const projects = projectsData?.projects ?? [];
  const projectInfoMap = useProjectInfoMap(teamId);
  const projectColors = useProjectColorMap(teamId);

  const [projectId, setProjectIdState] = useState<string>(
    searchParams.get("project_id") ?? ALL_PROJECTS,
  );
  const [hideInactive, setHideInactive] = useState(false);

  const isAllProjects = projectId === ALL_PROJECTS;

  function setProjectId(v: string) {
    setProjectIdState(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v === ALL_PROJECTS) params.delete("project_id");
    else params.set("project_id", v);
    const qs = params.toString();
    router.replace(`/dashboard/questionnaires${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  const teamData = useTeamQuestionnaires(
    isAllProjects ? teamId : undefined,
    { is_active: hideInactive ? true : undefined },
  );
  const projectData = useQuestionnaires(
    isAllProjects ? undefined : projectId,
    { is_active: hideInactive ? "true" : undefined },
  );

  const questionnaires = isAllProjects ? teamData.questionnaires : projectData.questionnaires;
  const isLoading = isAllProjects ? teamData.isLoading : projectData.isLoading;
  const mutate = isAllProjects ? teamData.mutate : projectData.mutate;

  const buckets = useMemo(
    () =>
      bucketByProject(questionnaires, (id) => projectInfoMap.get(id)?.name ?? id),
    [questionnaires, projectInfoMap],
  );

  // Card animation indices need to keep climbing across stacked buckets so the
  // stagger doesn't restart at 0 inside each section.
  let runningIndex = 0;

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
            preselectedProjectId={isAllProjects ? undefined : projectId}
            projects={projects}
            onCreated={() => mutate()}
          />
        </div>

        <QuestionnairesFilterBar
          projects={projects}
          projectId={projectId}
          hideInactive={hideInactive}
          onProjectChange={setProjectId}
          onHideInactiveChange={setHideInactive}
        />

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : questionnaires.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <ListChecks className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">
                {hideInactive
                  ? "No active questionnaires. Toggle \"Hide inactive\" off to see paused ones."
                  : <>
                      No questionnaires yet. Create one above and reference it from your SDK code with{" "}
                      <code className="text-foreground">.owlQuestionnaire(slug:&hellip;)</code>.
                    </>}
              </p>
            </CardContent>
          </Card>
        ) : isAllProjects ? (
          <div className="space-y-6">
            {buckets.map((bucket) => {
              const info = projectInfoMap.get(bucket.projectId);
              const sectionStart = runningIndex;
              runningIndex += bucket.items.length;
              return (
                <ProjectQuestionnairesSection
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
          <QuestionnaireCardGrid
            questionnaires={questionnaires}
            projectColors={projectColors}
          />
        )}
      </div>
    </AnimatedPage>
  );
}

function CreateQuestionnaireDialog({
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
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schemaText, setSchemaText] = useState(JSON.stringify(SAMPLE_SCHEMA, null, 2));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveProjectId = preselectedProjectId ?? dialogProjectId;
  const needsProjectPicker = !preselectedProjectId;

  const handleSubmit = async () => {
    if (!effectiveProjectId) {
      setError("Pick a project first.");
      return;
    }
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
      await questionnaireActions.create(effectiveProjectId, {
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
      setDialogProjectId("");
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
          {needsProjectPicker && (
            <div>
              <Label htmlFor="qs-project">Project</Label>
              <Select value={dialogProjectId} onValueChange={setDialogProjectId}>
                <SelectTrigger id="qs-project" className="w-full mt-1">
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
            <p className="text-xs text-muted-foreground mt-1">
              Set <code>&quot;multiline&quot;: true</code> on a <code>text</code> question to render a tall multi-line text box. Default is single-line.
            </p>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !slug || !name || !effectiveProjectId}
          >
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
