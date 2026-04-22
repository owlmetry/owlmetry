"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import type {
  ProjectResponse,
  FeedbackResponse,
  FeedbackStatus,
} from "@owlmetry/shared";
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import { useFeedback, useFeedbackDetail, feedbackActions } from "@/hooks/use-feedback";
import { useProjectColorMap } from "@/hooks/use-project-colors";
import { formatDateTime } from "@/lib/format-date";
import { timeAgo } from "@/app/dashboard/_components/time-ago";
import { CountryEmoji } from "@/components/country-flag";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageSquare, ChevronDown, Clock, Mail, User as UserIcon } from "lucide-react";
import { VisuallyHidden } from "radix-ui";
import { ProjectDot } from "@/lib/project-color";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { KanbanSkeleton } from "@/components/ui/skeletons";

const STATUS_CONFIG: Record<FeedbackStatus, { label: string; emoji: string; color: string }> = {
  new: { label: "New", emoji: "🆕", color: "bg-red-500/10 text-red-600" },
  in_review: { label: "In Review", emoji: "👀", color: "bg-blue-500/10 text-blue-600" },
  addressed: { label: "Addressed", emoji: "✅", color: "bg-green-500/10 text-green-600" },
  dismissed: { label: "Dismissed", emoji: "🚫", color: "bg-gray-500/10 text-gray-500" },
};

const KANBAN_COLUMNS: FeedbackStatus[] = ["new", "in_review", "addressed", "dismissed"];

function FeedbackCard({
  feedback,
  projectColor,
  onClick,
}: {
  feedback: FeedbackResponse;
  projectColor: string | undefined;
  onClick: () => void;
}) {
  const fromLabel =
    feedback.submitter_name ??
    feedback.submitter_email ??
    (feedback.user_id ? feedback.user_id.slice(0, 10) + "…" : null);
  return (
    <Card className="cursor-pointer hover:border-primary/30 transition-colors" onClick={onClick}>
      <CardContent className="p-3 space-y-2">
        <p className="text-sm leading-snug line-clamp-3">{feedback.message}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo(feedback.created_at)}
          </span>
          {fromLabel && (
            <span className="flex items-center gap-1 truncate">
              <UserIcon className="h-3 w-3" />
              <span className="truncate">{fromLabel}</span>
            </span>
          )}
          <CountryEmoji code={feedback.country_code} />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {feedback.app_name && (
            <Badge variant="outline" className="text-[10px] h-5 flex items-center gap-1">
              <ProjectDot color={projectColor} size={6} />
              {feedback.app_name}
            </Badge>
          )}
          {feedback.is_dev && (
            <Badge variant="secondary" className="text-[10px] h-5">
              🛠️ dev
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackDetailModal({
  projectId,
  projectColor,
  feedbackId,
  open,
  onClose,
  onMutate,
}: {
  projectId: string;
  projectColor: string | undefined;
  feedbackId: string;
  open: boolean;
  onClose: () => void;
  onMutate: () => void;
}) {
  const { feedback, isLoading, mutate: mutateDetail } = useFeedbackDetail(projectId, feedbackId);
  const [newComment, setNewComment] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const handleStatusChange = async (status: FeedbackStatus) => {
    setActionLoading(true);
    try {
      await feedbackActions.updateStatus(projectId, feedbackId, status);
      mutateDetail();
      onMutate();
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this feedback? This cannot be undone by agents.")) return;
    setActionLoading(true);
    try {
      await feedbackActions.remove(projectId, feedbackId);
      onMutate();
      onClose();
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    setActionLoading(true);
    try {
      await feedbackActions.addComment(projectId, feedbackId, newComment.trim());
      setNewComment("");
      mutateDetail();
    } finally {
      setActionLoading(false);
    }
  };

  if (!open) return null;
  const config = feedback ? STATUS_CONFIG[feedback.status] : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {isLoading || !feedback ? (
          <div className="py-8 text-center text-muted-foreground">
            <VisuallyHidden.Root><DialogTitle>Loading feedback</DialogTitle></VisuallyHidden.Root>
            Loading...
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <ProjectDot color={projectColor} />
                <Badge className={config?.color}>
                  {config?.emoji} {config?.label}
                </Badge>
                {feedback.is_dev && <Badge variant="secondary">🛠️ dev</Badge>}
              </div>
              <DialogTitle className="text-base leading-snug mt-2">
                Feedback from {feedback.submitter_name ?? feedback.submitter_email ?? (feedback.user_id ? feedback.user_id.slice(0, 12) + "…" : "anonymous user")}
              </DialogTitle>
            </DialogHeader>

            {/* Message */}
            <div className="mt-3 rounded-md border bg-muted/30 p-3">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{feedback.message}</p>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mt-4">
              <div><span className="text-muted-foreground">App:</span> {feedback.app_name ?? feedback.app_id}</div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Country:</span>
                <CountryEmoji code={feedback.country_code} />
                <span>{feedback.country_code ?? "—"}</span>
              </div>
              {feedback.submitter_email && (
                <div className="col-span-2 flex items-center gap-1">
                  <Mail className="h-3 w-3 text-muted-foreground" />
                  <a href={`mailto:${feedback.submitter_email}`} className="text-primary hover:underline">{feedback.submitter_email}</a>
                </div>
              )}
              <div><span className="text-muted-foreground">Version:</span> {feedback.app_version ?? "—"}{feedback.environment ? ` (${feedback.environment})` : ""}</div>
              <div><span className="text-muted-foreground">Device:</span> {feedback.device_model ?? "—"}{feedback.os_version ? `  OS ${feedback.os_version}` : ""}</div>
              <div><span className="text-muted-foreground">User ID:</span> {feedback.user_id ?? "anonymous"}</div>
              {feedback.session_id && (
                <div>
                  <span className="text-muted-foreground">Session:</span>{" "}
                  <a
                    href={`/dashboard/events?session_id=${feedback.session_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >{feedback.session_id.slice(0, 8)}…</a>
                </div>
              )}
              <div><span className="text-muted-foreground">Created:</span> {formatDateTime(feedback.created_at)}</div>
              <div><span className="text-muted-foreground">Updated:</span> {formatDateTime(feedback.updated_at)}</div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 mt-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={actionLoading}>
                    Actions <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {KANBAN_COLUMNS.filter((s) => s !== feedback.status).map((s) => (
                    <DropdownMenuItem key={s} onClick={() => handleStatusChange(s)}>
                      {STATUS_CONFIG[s].emoji} Move to {STATUS_CONFIG[s].label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600"
                    onClick={handleDelete}
                  >
                    🗑️ Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Comments */}
            <div className="mt-6">
              <h4 className="text-sm font-semibold mb-2">Comments</h4>
              {feedback.comments.length === 0 && (
                <p className="text-sm text-muted-foreground">No comments yet</p>
              )}
              <div className="space-y-3">
                {feedback.comments.map((c) => (
                  <div key={c.id} className="border rounded-md p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <span>{c.author_type === "agent" ? "🕶️" : "👤"} {c.author_name}</span>
                      <span>·</span>
                      <span>{formatDateTime(c.created_at)}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <textarea
                  placeholder="Add a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[60px] resize-y"
                />
              </div>
              <Button size="sm" className="mt-2" onClick={handleAddComment} disabled={actionLoading || !newComment.trim()}>
                Add Comment
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function FeedbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTeam } = useTeam();
  const { dataMode } = useDataMode();
  const teamId = currentTeam?.id;

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null,
  );
  const projects = projectsData?.projects ?? [];
  const projectColorMap = useProjectColorMap(teamId);

  const ALL = "__all__";
  const [projectId, setProjectIdState] = useState(searchParams.get("project_id") ?? ALL);
  const [search, setSearch] = useState("");
  const selectedFeedbackId = searchParams.get("feedback_id");

  function updateUrl(nextProjectId: string, nextFeedbackId: string | null) {
    const params = new URLSearchParams();
    if (nextProjectId && nextProjectId !== ALL) params.set("project_id", nextProjectId);
    if (nextFeedbackId) params.set("feedback_id", nextFeedbackId);
    const qs = params.toString();
    router.replace(`/dashboard/feedback${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  function setProjectId(id: string) {
    setProjectIdState(id);
    updateUrl(id, null);
  }

  function openFeedback(id: string) {
    updateUrl(projectId, id);
  }

  function closeFeedback() {
    updateUrl(projectId, null);
  }

  const selectedProjectId = projectId !== ALL ? projectId : "";

  const { feedback, isLoading, mutate } = useFeedback({
    team_id: teamId,
    ...(selectedProjectId ? { project_id: selectedProjectId } : {}),
    data_mode: dataMode,
  });

  const filtered = search.trim()
    ? feedback.filter((f) =>
        f.message.toLowerCase().includes(search.toLowerCase()) ||
        (f.submitter_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (f.submitter_email ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : feedback;

  const selectedFeedback = selectedFeedbackId
    ? filtered.find((f) => f.id === selectedFeedbackId) ?? feedback.find((f) => f.id === selectedFeedbackId)
    : null;

  const feedbackByStatus: Record<string, FeedbackResponse[]> = {};
  for (const status of KANBAN_COLUMNS) {
    feedbackByStatus[status] = filtered.filter((f) => f.status === status);
  }

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Project</label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-[220px] h-8 text-xs">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
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
          <div className="space-y-1 flex-1 min-w-[200px] max-w-[360px]">
            <label className="text-xs text-muted-foreground">Search</label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by message, name, or email..."
              className="h-8 text-xs"
            />
          </div>
        </div>
      </StaggerItem>

      <StaggerItem index={1}>
      {isLoading ? (
        <KanbanSkeleton columns={4} />
      ) : feedback.length === 0 ? (
        <div className="text-center py-12">
          <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">No feedback yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Feedback appears here when users submit it via the OwlFeedbackView SwiftUI component or Owl.sendFeedback.
          </p>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((status) => {
            const config = STATUS_CONFIG[status];
            const colFeedback = feedbackByStatus[status] ?? [];
            return (
              <div key={status} className="flex-shrink-0 w-[280px]">
                <div className="flex items-center gap-2 mb-3">
                  <span>{config.emoji}</span>
                  <span className="text-sm font-semibold">{config.label}</span>
                  <Badge variant="secondary" className="text-[10px] h-5 ml-auto">
                    {colFeedback.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {colFeedback.map((fb) => (
                    <FeedbackCard
                      key={fb.id}
                      feedback={fb}
                      projectColor={projectColorMap.get(fb.project_id)}
                      onClick={() => openFeedback(fb.id)}
                    />
                  ))}
                  {colFeedback.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No feedback
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </StaggerItem>

      {selectedFeedbackId && selectedFeedback && (
        <FeedbackDetailModal
          projectId={selectedFeedback.project_id}
          projectColor={projectColorMap.get(selectedFeedback.project_id)}
          feedbackId={selectedFeedbackId}
          open={!!selectedFeedbackId}
          onClose={closeFeedback}
          onMutate={() => mutate()}
        />
      )}
    </AnimatedPage>
  );
}
