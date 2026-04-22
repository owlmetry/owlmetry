"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import type { ProjectResponse, IssueResponse, IssueStatus } from "@owlmetry/shared";
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import { useIssues, useIssue, issueActions } from "@/hooks/use-issues";
import { useProjectColorMap } from "@/hooks/use-project-colors";
import { formatDateTime } from "@/lib/format-date";
import { CountryEmoji } from "@/components/country-flag";
// Deep import bypasses the barrel export which pulls in node:crypto
import { formatBytes } from "@owlmetry/shared/constants";
import {
  AttachmentDownloadButton,
  AttachmentUntrustedNotice,
} from "@/components/attachment-download-button";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bug, ChevronDown, Clock, Users } from "lucide-react";
import { VisuallyHidden } from "radix-ui";
import { ProjectDot } from "@/lib/project-color";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { KanbanSkeleton } from "@/components/ui/skeletons";

const STATUS_CONFIG: Record<IssueStatus, { label: string; emoji: string; color: string }> = {
  new: { label: "New", emoji: "🆕", color: "bg-red-500/10 text-red-600" },
  in_progress: { label: "In Progress", emoji: "🔧", color: "bg-blue-500/10 text-blue-600" },
  regressed: { label: "Regressed", emoji: "🔄", color: "bg-yellow-500/10 text-yellow-600" },
  resolved: { label: "Resolved", emoji: "✅", color: "bg-green-500/10 text-green-600" },
  silenced: { label: "Silenced", emoji: "🔇", color: "bg-gray-500/10 text-gray-500" },
};

const KANBAN_COLUMNS: IssueStatus[] = ["new", "in_progress", "regressed", "resolved", "silenced"];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function IssueCard({ issue, projectColor, onClick }: { issue: IssueResponse; projectColor: string | undefined; onClick: () => void }) {
  return (
    <Card
      className="cursor-pointer hover:border-primary/30 transition-colors"
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        <p className="text-sm font-medium leading-tight line-clamp-2">{issue.title}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Bug className="h-3 w-3" />
            {issue.occurrence_count}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {issue.unique_user_count}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo(issue.last_seen_at)}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {issue.app_name && (
            <Badge variant="outline" className="text-[10px] h-5 flex items-center gap-1">
              <ProjectDot color={projectColor} size={6} />
              {issue.app_name}
            </Badge>
          )}
          {issue.is_dev && (
            <Badge variant="secondary" className="text-[10px] h-5">
              🛠️ dev
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function IssueDetailModal({
  projectId,
  projectColor,
  issueId,
  open,
  onClose,
  onMutate,
  allIssues,
}: {
  projectId: string;
  projectColor: string | undefined;
  issueId: string;
  open: boolean;
  onClose: () => void;
  onMutate: () => void;
  allIssues: IssueResponse[];
}) {
  const { issue, isLoading, mutate: mutateIssue } = useIssue(projectId, issueId);
  const [resolveVersion, setResolveVersion] = useState("");
  const [showResolveInput, setShowResolveInput] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Only show merge candidates from the same project
  const mergeableSameProject = allIssues.filter((i) => i.id !== issueId && i.project_id === projectId);

  const handleStatusChange = async (status: string, version?: string) => {
    setActionLoading(true);
    try {
      await issueActions.updateStatus(projectId, issueId, status, version);
      mutateIssue();
      onMutate();
      setShowResolveInput(false);
      setResolveVersion("");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    setActionLoading(true);
    try {
      await issueActions.addComment(projectId, issueId, newComment.trim());
      setNewComment("");
      mutateIssue();
    } finally {
      setActionLoading(false);
    }
  };

  if (!open) return null;
  const config = issue ? STATUS_CONFIG[issue.status] : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {isLoading || !issue ? (
          <div className="py-8 text-center text-muted-foreground">
            <VisuallyHidden.Root><DialogTitle>Loading issue</DialogTitle></VisuallyHidden.Root>
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
                {issue.is_dev && <Badge variant="secondary">🛠️ dev</Badge>}
              </div>
              <DialogTitle className="text-base leading-snug mt-2">{issue.title}</DialogTitle>
            </DialogHeader>

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mt-2">
              <div><span className="text-muted-foreground">App:</span> {issue.app_name ?? issue.app_id}</div>
              <div><span className="text-muted-foreground">Source:</span> {issue.source_module ?? "—"}</div>
              <div><span className="text-muted-foreground">Occurrences:</span> {issue.occurrence_count}</div>
              <div><span className="text-muted-foreground">Unique Users:</span> {issue.unique_user_count}</div>
              <div><span className="text-muted-foreground">First Seen:</span> {formatDateTime(issue.first_seen_at)}</div>
              <div><span className="text-muted-foreground">Last Seen:</span> {formatDateTime(issue.last_seen_at)}</div>
              {issue.resolved_at_version && (
                <div className="col-span-2"><span className="text-muted-foreground">Resolved In:</span> v{issue.resolved_at_version}</div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 mt-4">
              {showResolveInput ? (
                <div className="flex items-center gap-2 w-full">
                  <Input
                    placeholder="Version (optional)"
                    value={resolveVersion}
                    onChange={(e) => setResolveVersion(e.target.value)}
                    className="h-8 w-40"
                  />
                  <Button size="sm" onClick={() => handleStatusChange("resolved", resolveVersion || undefined)} disabled={actionLoading}>
                    Confirm
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowResolveInput(false)}>Cancel</Button>
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" disabled={actionLoading}>
                      Actions <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {issue.status !== "resolved" && (
                      <DropdownMenuItem onClick={() => setShowResolveInput(true)}>
                        ✅ Resolve
                      </DropdownMenuItem>
                    )}
                    {issue.status !== "silenced" && (
                      <DropdownMenuItem onClick={() => handleStatusChange("silenced")}>
                        🔇 Silence
                      </DropdownMenuItem>
                    )}
                    {issue.status !== "in_progress" && issue.status !== "resolved" && (
                      <DropdownMenuItem onClick={() => handleStatusChange("in_progress")}>
                        🔧 Claim
                      </DropdownMenuItem>
                    )}
                    {(issue.status === "resolved" || issue.status === "silenced" || issue.status === "in_progress") && (
                      <DropdownMenuItem onClick={() => handleStatusChange("new")}>
                        🆕 Reopen
                      </DropdownMenuItem>
                    )}
                    {mergeableSameProject.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Merge into this</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="max-h-48 overflow-y-auto">
                            {mergeableSameProject.map((i) => (
                                <DropdownMenuItem
                                  key={i.id}
                                  onClick={async () => {
                                    setActionLoading(true);
                                    try {
                                      await issueActions.merge(projectId, issueId, i.id);
                                      mutateIssue();
                                      onMutate();
                                    } finally {
                                      setActionLoading(false);
                                    }
                                  }}
                                >
                                  {STATUS_CONFIG[i.status]?.emoji} {i.title.slice(0, 50)}{i.title.length > 50 ? "..." : ""}
                                </DropdownMenuItem>
                              ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Comments */}
            <div className="mt-6">
              <h4 className="text-sm font-semibold mb-2">Comments</h4>
              {issue.comments.length === 0 && (
                <p className="text-sm text-muted-foreground">No comments yet</p>
              )}
              <div className="space-y-3">
                {issue.comments.map((c) => (
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

            {/* Occurrences */}
            <div className="mt-6">
              <h4 className="text-sm font-semibold mb-2">Occurrences ({issue.occurrence_count})</h4>
              {issue.occurrences.length === 0 ? (
                <p className="text-sm text-muted-foreground">No occurrences recorded</p>
              ) : (
                <div className="text-xs border rounded-md divide-y">
                  <div className="grid grid-cols-5 gap-2 p-2 font-medium text-muted-foreground bg-muted/30">
                    <span>Time</span>
                    <span>Session</span>
                    <span>User</span>
                    <span>Version</span>
                    <span>Env</span>
                  </div>
                  {issue.occurrences.map((occ) => (
                    <div key={occ.id} className="grid grid-cols-5 gap-2 p-2">
                      <span>{formatDateTime(occ.timestamp)}</span>
                      <a
                        href={`/dashboard/events?session_id=${occ.session_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono truncate text-primary hover:underline"
                      >{occ.session_id.slice(0, 8)}…</a>
                      <span className="truncate inline-flex items-center gap-1">
                        <CountryEmoji code={occ.country_code} />
                        {occ.user_id ?? <span className="text-muted-foreground">anon</span>}
                      </span>
                      <span>{occ.app_version ?? "—"}</span>
                      <span>{occ.environment ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Attachments */}
            {issue.attachments && issue.attachments.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-semibold mb-2">📎 Attachments ({issue.attachments.length})</h4>
                <AttachmentUntrustedNotice />
                <div className="text-xs border rounded-md divide-y">
                  <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 p-2 font-medium text-muted-foreground bg-muted/30">
                    <span>Filename</span>
                    <span>Size</span>
                    <span>Type</span>
                    <span>Uploaded</span>
                  </div>
                  {issue.attachments.map((a) => (
                    <div key={a.id} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 p-2 items-center">
                      <span className="truncate" title={a.original_filename}>{a.original_filename}</span>
                      <span>{formatBytes(a.size_bytes)}</span>
                      <span className="truncate text-muted-foreground" title={a.content_type}>{a.content_type}</span>
                      <AttachmentDownloadButton attachmentId={a.id} uploadedAt={a.uploaded_at} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fingerprints */}
            {issue.fingerprints.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-1">Fingerprints</h4>
                <div className="space-y-1">
                  {issue.fingerprints.map((fp) => (
                    <code key={fp} className="block text-[10px] text-muted-foreground font-mono">{fp}</code>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function IssuesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTeam } = useTeam();
  const { dataMode } = useDataMode();
  const teamId = currentTeam?.id;

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null
  );
  const projects = projectsData?.projects ?? [];
  const projectColorMap = useProjectColorMap(teamId);

  const ALL = "__all__";
  const [projectId, setProjectIdState] = useState(searchParams.get("project_id") ?? ALL);
  const selectedIssueId = searchParams.get("issue_id");

  function updateUrl(nextProjectId: string, nextIssueId: string | null) {
    const params = new URLSearchParams();
    if (nextProjectId && nextProjectId !== ALL) params.set("project_id", nextProjectId);
    if (nextIssueId) params.set("issue_id", nextIssueId);
    const qs = params.toString();
    router.replace(`/dashboard/issues${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  function setProjectId(id: string) {
    setProjectIdState(id);
    updateUrl(id, null);
  }

  function openIssue(id: string) {
    updateUrl(projectId, id);
  }

  function closeIssue() {
    updateUrl(projectId, null);
  }

  const selectedProjectId = projectId !== ALL ? projectId : "";

  const { issues, isLoading, mutate } = useIssues({
    team_id: teamId,
    ...(selectedProjectId ? { project_id: selectedProjectId } : {}),
    data_mode: dataMode,
  });

  const selectedIssue = selectedIssueId ? issues.find((i) => i.id === selectedIssueId) : null;

  // Group issues by status for kanban columns.
  // "New" is sorted by severity (unique users affected) so the most impactful issues surface first.
  const issuesByStatus: Record<string, IssueResponse[]> = {};
  for (const status of KANBAN_COLUMNS) {
    const col = issues.filter((i) => i.status === status);
    if (status === "new") {
      col.sort((a, b) => {
        if (b.unique_user_count !== a.unique_user_count) {
          return b.unique_user_count - a.unique_user_count;
        }
        return new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
      });
    }
    issuesByStatus[status] = col;
  }

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
        <div className="flex items-center gap-3">
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
        </div>
      </StaggerItem>

      <StaggerItem index={1}>
      {isLoading ? (
        <KanbanSkeleton columns={5} />
      ) : issues.length === 0 ? (
        <div className="text-center py-12">
          <Bug className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">No issues found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Issues are automatically created when error events are detected during the hourly scan.
          </p>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((status) => {
            const config = STATUS_CONFIG[status];
            const colIssues = issuesByStatus[status] ?? [];
            return (
              <div key={status} className="flex-shrink-0 w-[250px]">
                <div className="flex items-center gap-2 mb-3">
                  <span>{config.emoji}</span>
                  <span className="text-sm font-semibold">{config.label}</span>
                  <Badge variant="secondary" className="text-[10px] h-5 ml-auto">
                    {colIssues.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {colIssues.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      projectColor={projectColorMap.get(issue.project_id)}
                      onClick={() => openIssue(issue.id)}
                    />
                  ))}
                  {colIssues.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No issues
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </StaggerItem>

      {selectedIssueId && selectedIssue && (
        <IssueDetailModal
          projectId={selectedIssue.project_id}
          projectColor={projectColorMap.get(selectedIssue.project_id)}
          issueId={selectedIssueId}
          open={!!selectedIssueId}
          onClose={closeIssue}
          onMutate={() => mutate()}
          allIssues={issues}
        />
      )}
    </AnimatedPage>
  );
}
