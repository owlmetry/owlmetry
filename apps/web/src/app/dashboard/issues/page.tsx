"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import type { ProjectResponse, IssueResponse, IssueStatus } from "@owlmetry/shared";
import { ISSUE_STATUSES } from "@owlmetry/shared";
import { useTeam } from "@/contexts/team-context";
import { useIssues, useIssue, issueActions } from "@/hooks/use-issues";
import { api } from "@/lib/api";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Bug, Clock, Users } from "lucide-react";

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

function IssueCard({ issue, onClick }: { issue: IssueResponse; onClick: () => void }) {
  const config = STATUS_CONFIG[issue.status];
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
        {issue.app_name && (
          <Badge variant="outline" className="text-[10px] h-5">
            {issue.app_name}
          </Badge>
        )}
        {issue.is_dev && (
          <Badge variant="secondary" className="text-[10px] h-5 ml-1">
            🛠️ dev
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

function IssueDetailModal({
  projectId,
  issueId,
  open,
  onClose,
  onMutate,
}: {
  projectId: string;
  issueId: string;
  open: boolean;
  onClose: () => void;
  onMutate: () => void;
}) {
  const { issue, isLoading, mutate: mutateIssue } = useIssue(projectId, issueId);
  const [resolveVersion, setResolveVersion] = useState("");
  const [showResolveInput, setShowResolveInput] = useState(false);
  const [showMergeSelect, setShowMergeSelect] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const { issues: allIssues } = useIssues(projectId);

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
          <div className="py-8 text-center text-muted-foreground">Loading...</div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
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
              <div><span className="text-muted-foreground">First Seen:</span> {new Date(issue.first_seen_at).toLocaleString()}</div>
              <div><span className="text-muted-foreground">Last Seen:</span> {new Date(issue.last_seen_at).toLocaleString()}</div>
              {issue.resolved_at_version && (
                <div className="col-span-2"><span className="text-muted-foreground">Resolved In:</span> v{issue.resolved_at_version}</div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mt-4">
              {issue.status !== "resolved" && !showResolveInput && (
                <Button size="sm" variant="outline" onClick={() => setShowResolveInput(true)} disabled={actionLoading}>
                  ✅ Resolve
                </Button>
              )}
              {showResolveInput && (
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
              )}
              {issue.status !== "silenced" && (
                <Button size="sm" variant="outline" onClick={() => handleStatusChange("silenced")} disabled={actionLoading}>
                  🔇 Silence
                </Button>
              )}
              {issue.status !== "in_progress" && issue.status !== "resolved" && (
                <Button size="sm" variant="outline" onClick={() => handleStatusChange("in_progress")} disabled={actionLoading}>
                  🔧 Claim
                </Button>
              )}
              {(issue.status === "resolved" || issue.status === "silenced" || issue.status === "in_progress") && (
                <Button size="sm" variant="outline" onClick={() => handleStatusChange("new")} disabled={actionLoading}>
                  🆕 Reopen
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setShowMergeSelect(!showMergeSelect)} disabled={actionLoading}>
                Merge
              </Button>
            </div>

            {showMergeSelect && (
              <div className="border rounded-md p-3 mt-2 space-y-2">
                <p className="text-xs text-muted-foreground">Select an issue to merge into this one:</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {allIssues
                    .filter((i) => i.id !== issueId)
                    .map((i) => (
                      <button
                        key={i.id}
                        className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted truncate"
                        onClick={async () => {
                          setActionLoading(true);
                          try {
                            await issueActions.merge(projectId, issueId, i.id);
                            mutateIssue();
                            onMutate();
                            setShowMergeSelect(false);
                          } finally {
                            setActionLoading(false);
                          }
                        }}
                        disabled={actionLoading}
                      >
                        {STATUS_CONFIG[i.status]?.emoji} {i.title.slice(0, 60)}{i.title.length > 60 ? "..." : ""}
                      </button>
                    ))}
                  {allIssues.filter((i) => i.id !== issueId).length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">No other issues to merge</p>
                  )}
                </div>
              </div>
            )}

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
                      <span>{new Date(c.created_at).toLocaleString()}</span>
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
                      <span>{new Date(occ.timestamp).toLocaleString()}</span>
                      <span className="font-mono truncate">{occ.session_id.slice(0, 8)}…</span>
                      <span className="truncate">{occ.user_id ?? <span className="text-muted-foreground">anon</span>}</span>
                      <span>{occ.app_version ?? "—"}</span>
                      <span>{occ.environment ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

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
  const teamId = currentTeam?.id;

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null
  );
  const projects = projectsData?.projects ?? [];

  const initialProjectId = searchParams.get("project") ?? "";
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const effectiveProjectId = selectedProjectId || projects[0]?.id;

  const { issues, isLoading, mutate } = useIssues(effectiveProjectId);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  const handleProjectChange = (value: string) => {
    setSelectedProjectId(value);
    router.replace(`/dashboard/issues?project=${value}`, { scroll: false });
  };

  // Group issues by status for kanban columns
  const issuesByStatus: Record<string, IssueResponse[]> = {};
  for (const status of KANBAN_COLUMNS) {
    issuesByStatus[status] = issues.filter((i) => i.status === status);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Issues</h1>
        {projects.length > 0 && (
          <Select value={effectiveProjectId} onValueChange={handleProjectChange}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!effectiveProjectId ? (
        <p className="text-muted-foreground">Select a project to view issues</p>
      ) : isLoading ? (
        <p className="text-muted-foreground">Loading issues...</p>
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
                      onClick={() => setSelectedIssueId(issue.id)}
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

      {selectedIssueId && effectiveProjectId && (
        <IssueDetailModal
          projectId={effectiveProjectId}
          issueId={selectedIssueId}
          open={!!selectedIssueId}
          onClose={() => setSelectedIssueId(null)}
          onMutate={() => mutate()}
        />
      )}
    </div>
  );
}
