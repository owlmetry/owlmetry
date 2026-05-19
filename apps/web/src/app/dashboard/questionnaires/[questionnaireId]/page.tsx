"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type {
  ProjectResponse,
  QuestionnaireListResponse,
  QuestionnaireQuestion,
  QuestionnaireQuestionAnalytics,
} from "@owlmetry/shared";
import { useTeam } from "@/contexts/team-context";
import {
  useQuestionnaire,
  useQuestionnaireResponses,
  useQuestionnaireAnalytics,
  useQuestionnaireResponseDetail,
  questionnaireActions,
} from "@/hooks/use-questionnaires";
import { formatDateTime } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Star } from "lucide-react";
import Link from "next/link";
import { AnimatedPage } from "@/components/ui/animated-page";

export default function QuestionnaireDetailPage() {
  const params = useParams<{ questionnaireId: string }>();
  const questionnaireId = params?.questionnaireId;
  const searchParams = useSearchParams();
  const projectIdFromUrl = searchParams?.get("project_id") ?? null;
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id;

  // The list page links here with ?project_id=… so the owning project is known
  // up front. As a fallback for direct URL hits, look up the team's project
  // list once and find the project whose questionnaires include this id —
  // one extra GET, not N GETs.
  const { data: projects } = useSWR<{ projects: ProjectResponse[] }>(
    teamId && !projectIdFromUrl ? `/v1/projects?team_id=${teamId}` : null,
  );
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(
    projectIdFromUrl,
  );

  useEffect(() => {
    if (resolvedProjectId || !projects || !questionnaireId) return;
    let cancelled = false;
    (async () => {
      for (const p of projects.projects) {
        try {
          const res = await fetch(
            `/v1/projects/${p.id}/questionnaires?limit=1&app_id=`,
          );
          if (!res.ok) continue;
          const body = (await res.json()) as QuestionnaireListResponse;
          if (body.questionnaires.some((q) => q.id === questionnaireId)) {
            if (!cancelled) setResolvedProjectId(p.id);
            return;
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [projects, questionnaireId, resolvedProjectId]);

  const projectId = resolvedProjectId ?? undefined;
  const { questionnaire, mutate: mutateQuestionnaire } = useQuestionnaire(projectId, questionnaireId);
  const { responses } = useQuestionnaireResponses(projectId, questionnaireId, { limit: "50" });
  const { analytics } = useQuestionnaireAnalytics(projectId, questionnaireId);
  const [openResponseId, setOpenResponseId] = useState<string | null>(null);
  const { response: openResponse } = useQuestionnaireResponseDetail(
    projectId,
    questionnaireId,
    openResponseId ?? undefined,
  );

  if (!questionnaire) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <AnimatedPage>
      <div className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              href="/dashboard/questionnaires"
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
            >
              <ArrowLeft className="h-3 w-3" /> Back to questionnaires
            </Link>
            <h1 className="text-2xl font-bold">{questionnaire.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              <code className="text-foreground">{questionnaire.slug}</code>
              {questionnaire.description ? ` · ${questionnaire.description}` : null}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span
              className={
                questionnaire.is_active
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground"
              }
            >
              {questionnaire.is_active ? "Active" : "Paused"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!resolvedProjectId) return;
                await questionnaireActions.update(resolvedProjectId, questionnaire.id, {
                  is_active: !questionnaire.is_active,
                });
                await mutateQuestionnaire();
              }}
            >
              {questionnaire.is_active ? "Pause" : "Resume"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Total responses"
            value={String(questionnaire.response_count ?? 0)}
            sublabel={
              (questionnaire.response_count ?? 0) > 0
                ? `${questionnaire.submitted_count ?? 0} completed · ${
                    (questionnaire.response_count ?? 0) - (questionnaire.submitted_count ?? 0)
                  } in progress`
                : undefined
            }
          />
          <StatCard
            label="Last response"
            value={
              questionnaire.last_response_at
                ? formatDateTime(questionnaire.last_response_at)
                : "—"
            }
          />
          <StatCard label="Questions" value={String(questionnaire.schema.questions.length)} />
        </div>

        {analytics && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Analytics
                <span className="text-xs font-normal text-muted-foreground">
                  ({analytics.total_responses} total · {analytics.submitted_count} completed)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {analytics.questions.map((q) => (
                <QuestionAnalytics
                  key={q.id}
                  analytics={q}
                  schemaQuestion={questionnaire.schema.questions.find(
                    (sq) => sq.id === q.id,
                  )}
                />
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Recent responses</CardTitle>
          </CardHeader>
          <CardContent>
            {responses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No responses yet.</p>
            ) : (
              <div className="space-y-2">
                {responses.map((r) => {
                  const firstAnswer = Object.values(r.answers)[0];
                  const sample = firstAnswer === undefined
                    ? "—"
                    : Array.isArray(firstAnswer)
                      ? firstAnswer.join(", ")
                      : String(firstAnswer);
                  const answered = Object.keys(r.answers).length;
                  const total = questionnaire.schema.questions.length;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setOpenResponseId(r.id)}
                      className="w-full text-left rounded-md border border-border px-3 py-2 hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm truncate flex-1">{sample}</div>
                        <div className="flex items-center gap-2 shrink-0">
                          <ResponseStateBadge isComplete={r.is_complete} answered={answered} total={total} />
                          <div className="text-xs text-muted-foreground">
                            {formatDateTime(r.created_at)}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {r.user_id ?? "anonymous"}
                        {r.app_version ? ` · ${r.app_version}` : ""}
                        {r.environment ? ` · ${r.environment}` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={openResponseId !== null}
          onOpenChange={(open) => !open && setOpenResponseId(null)}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Response</DialogTitle>
            </DialogHeader>
            {openResponse ? (
              <div className="space-y-4 text-sm">
                <div className="flex items-center gap-2">
                  <ResponseStateBadge
                    isComplete={openResponse.is_complete}
                    answered={Object.keys(openResponse.answers).length}
                    total={questionnaire.schema.questions.length}
                  />
                  <span className="text-xs text-muted-foreground">
                    {openResponse.is_complete
                      ? `Submitted ${formatDateTime(openResponse.submitted_at ?? openResponse.created_at)}`
                      : `In progress — last saved ${formatDateTime(openResponse.updated_at)}`}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>User: <span className="text-foreground">{openResponse.user_id ?? "anonymous"}</span></div>
                  <div>Created: <span className="text-foreground">{formatDateTime(openResponse.created_at)}</span></div>
                  <div>Version: <span className="text-foreground">{openResponse.app_version ?? "—"}</span></div>
                  <div>Environment: <span className="text-foreground">{openResponse.environment ?? "—"}</span></div>
                </div>
                <div className="space-y-3">
                  {/* Drafts have no snapshot — render against the live schema
                      so freshly-added questions appear as "(no answer)". */}
                  {(openResponse.schema_snapshot ?? questionnaire.schema).questions.map((q) => {
                    const answer = (openResponse.answers as Record<string, unknown>)[q.id];
                    let display: React.ReactNode;
                    if (answer === undefined) {
                      display = <span className="text-muted-foreground">(no answer)</span>;
                    } else if (q.type === "single_choice") {
                      const opt = q.options.find((o) => o.id === answer);
                      display = opt?.label ?? String(answer);
                    } else if (q.type === "multi_choice" && Array.isArray(answer)) {
                      display = answer
                        .map((id) => q.options.find((o) => o.id === id)?.label ?? id)
                        .join(", ");
                    } else if (q.type === "rating" && typeof answer === "number") {
                      display = (
                        <span className="flex items-center gap-1">
                          {Array.from({ length: q.scale }).map((_, i) => (
                            <Star
                              key={i}
                              className={
                                i < answer
                                  ? "h-4 w-4 fill-amber-500 text-amber-500"
                                  : "h-4 w-4 text-muted-foreground"
                              }
                            />
                          ))}
                          <span className="ml-1 text-xs text-muted-foreground">{answer}/{q.scale}</span>
                        </span>
                      );
                    } else {
                      display = String(answer);
                    }
                    return (
                      <div key={q.id}>
                        <div className="text-xs text-muted-foreground">{q.title}</div>
                        <div className="text-sm">{display}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AnimatedPage>
  );
}

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold mt-1">{value}</div>
        {sublabel ? (
          <div className="text-xs text-muted-foreground mt-1">{sublabel}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ResponseStateBadge({
  isComplete,
  answered,
  total,
}: {
  isComplete: boolean;
  answered: number;
  total: number;
}) {
  if (isComplete) {
    return (
      <span className="text-[10px] uppercase tracking-wide font-semibold rounded-full px-2 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        Submitted
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-wide font-semibold rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-800 dark:text-amber-300 flex items-center gap-1">
      Draft <span className="opacity-70 normal-case tracking-normal">· {answered}/{total}</span>
    </span>
  );
}

function QuestionAnalytics({
  analytics,
  schemaQuestion,
}: {
  analytics: QuestionnaireQuestionAnalytics;
  schemaQuestion: QuestionnaireQuestion | undefined;
}) {
  const title = schemaQuestion?.title ?? analytics.id;
  if (analytics.type === "text") {
    return (
      <div>
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
        <div className="text-xs text-muted-foreground mb-1">
          {analytics.total_answered} answers
        </div>
        {analytics.recent_answers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No text answers yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {analytics.recent_answers.map((a) => (
              <li key={a.response_id} className="truncate">
                · {a.answer}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (analytics.type === "single_choice" || analytics.type === "multi_choice") {
    const max = Math.max(1, ...analytics.choices.map((c) => c.count));
    return (
      <div>
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
        <div className="text-xs text-muted-foreground mb-2">
          {analytics.total_answered} {analytics.type === "multi_choice" ? "responses (multiple-choice; sum exceeds total)" : "answers"}
        </div>
        <div className="space-y-2">
          {analytics.choices.map((c) => {
            const pct = analytics.total_answered > 0
              ? Math.round((c.count / analytics.total_answered) * 100)
              : 0;
            return (
              <div key={c.id}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span>{c.label}</span>
                  <span className="text-muted-foreground">{c.count} ({pct}%)</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${(c.count / max) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (analytics.type === "rating") {
    const max = Math.max(1, ...analytics.buckets.map((b) => b.count));
    return (
      <div>
        <h3 className="text-sm font-semibold mb-2">
          {title} <span className="text-xs text-muted-foreground">avg {analytics.average ?? "—"}</span>
        </h3>
        <div className="space-y-2">
          {analytics.buckets.map((b) => (
            <div key={b.value}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="flex items-center gap-1">
                  {Array.from({ length: b.value }).map((_, i) => (
                    <Star key={i} className="h-3 w-3 fill-amber-500 text-amber-500" />
                  ))}
                </span>
                <span className="text-muted-foreground">{b.count}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-500" style={{ width: `${(b.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (analytics.type !== "nps") return null;
  // NPS
  const max = Math.max(1, ...analytics.buckets.map((b) => b.count));
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">
        {title}{" "}
        <span className="text-xs text-muted-foreground">
          score {analytics.score ?? "—"}
        </span>
      </h3>
      <div className="flex items-center gap-2 text-xs mb-3">
        <span className="text-red-600 dark:text-red-400">
          Detractors: {analytics.detractors}
        </span>
        <span className="text-amber-600 dark:text-amber-400">
          Passives: {analytics.passives}
        </span>
        <span className="text-emerald-600 dark:text-emerald-400">
          Promoters: {analytics.promoters}
        </span>
      </div>
      <div className="grid grid-cols-11 gap-1">
        {analytics.buckets.map((b) => {
          const color =
            b.value <= 6
              ? "bg-red-500"
              : b.value <= 8
                ? "bg-amber-500"
                : "bg-emerald-500";
          return (
            <div key={b.value} className="flex flex-col items-center gap-1">
              <div
                className="w-full bg-muted rounded h-16 flex items-end overflow-hidden"
                title={`${b.count} responses`}
              >
                <div
                  className={`w-full ${color}`}
                  style={{ height: `${(b.count / max) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">{b.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
