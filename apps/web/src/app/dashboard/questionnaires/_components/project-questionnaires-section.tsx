"use client";

import type { QuestionnaireSpec } from "@owlmetry/shared";
import { ProjectDot } from "@/lib/project-color";
import { QuestionnaireCardGrid } from "./questionnaire-card-grid";

export interface ProjectQuestionnairesBucket {
  projectId: string;
  items: QuestionnaireSpec[];
  totalResponses: number;
}

/**
 * Group questionnaires by project_id, sum response counts per bucket, then
 * sort: most responses first, then by project name (resolved via the
 * caller's lookup) for stable tiebreaks.
 */
export function bucketByProject(
  questionnaires: QuestionnaireSpec[],
  resolveProjectName: (projectId: string) => string,
): ProjectQuestionnairesBucket[] {
  const map = new Map<string, ProjectQuestionnairesBucket>();
  for (const q of questionnaires) {
    let bucket = map.get(q.project_id);
    if (!bucket) {
      bucket = { projectId: q.project_id, items: [], totalResponses: 0 };
      map.set(q.project_id, bucket);
    }
    bucket.items.push(q);
    bucket.totalResponses += q.response_count ?? 0;
  }
  return [...map.values()].sort((a, b) => {
    if (b.totalResponses !== a.totalResponses) return b.totalResponses - a.totalResponses;
    return resolveProjectName(a.projectId).localeCompare(resolveProjectName(b.projectId));
  });
}

interface ProjectQuestionnairesSectionProps {
  projectName: string;
  projectColor: string | null | undefined;
  bucket: ProjectQuestionnairesBucket;
  projectColors: Map<string, string>;
  startIndex: number;
}

export function ProjectQuestionnairesSection({
  projectName,
  projectColor,
  bucket,
  projectColors,
  startIndex,
}: ProjectQuestionnairesSectionProps) {
  const definitionLabel = `${bucket.items.length} questionnaire${bucket.items.length === 1 ? "" : "s"}`;
  const responseLabel = `${bucket.totalResponses.toLocaleString()} response${bucket.totalResponses === 1 ? "" : "s"}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <ProjectDot color={projectColor} size={10} />
          <h2 className="text-sm font-semibold truncate">{projectName}</h2>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          <span className="text-foreground font-medium">{definitionLabel}</span>
          {" · "}
          <span className="text-foreground font-medium">{responseLabel}</span>
        </div>
      </div>
      <QuestionnaireCardGrid
        questionnaires={bucket.items}
        projectColors={projectColors}
        hideProjectDot
        startIndex={startIndex}
      />
    </div>
  );
}
