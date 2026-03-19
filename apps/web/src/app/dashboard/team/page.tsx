"use client";

import { useState } from "react";
import useSWR from "swr";
import { Trash2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { api, ApiError } from "@/lib/api";
import { useUser } from "@/hooks/use-user";
import { useTeam } from "@/contexts/team-context";
import {
  canManageRole,
  meetsMinimumRole,
  VALID_TEAM_ROLES,
} from "@owlmetry/shared/auth";
import type { TeamDetailResponse, TeamRole } from "@owlmetry/shared";
import { useRouter } from "next/navigation";

function roleBadgeVariant(role: TeamRole) {
  if (role === "owner") return "default" as const;
  if (role === "admin") return "secondary" as const;
  return "outline" as const;
}

function assignableRoles(actorRole: TeamRole): TeamRole[] {
  return VALID_TEAM_ROLES.filter((r) => actorRole === "owner" || r !== "owner");
}

export default function TeamPage() {
  const { currentTeam, currentRole, teams } = useTeam();
  const { user, mutate: mutateUser } = useUser();
  const router = useRouter();

  const {
    data: teamDetail,
    mutate,
  } = useSWR<TeamDetailResponse>(
    currentTeam ? `/v1/teams/${currentTeam.id}` : null,
  );

  if (!currentTeam || !currentRole) {
    return <p className="text-muted-foreground">No team selected.</p>;
  }

  const members = teamDetail?.members ?? [];
  const isAdmin = meetsMinimumRole(currentRole, "admin");
  const isOwner = currentRole === "owner";

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Team</h1>

      {/* Members section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Members</CardTitle>
          {isAdmin && <InviteMemberDialog teamId={currentTeam.id} currentRole={currentRole} onInvited={() => mutate()} />}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isSelf = member.user_id === user?.id;
                const canManage = canManageRole(currentRole, member.role) && !isSelf;
                const isSoleOwner =
                  isSelf &&
                  member.role === "owner" &&
                  members.filter((m) => m.role === "owner").length === 1;

                return (
                  <TableRow key={member.user_id}>
                    <TableCell>
                      {member.name}
                      {isSelf && (
                        <span className="ml-1 text-muted-foreground">(you)</span>
                      )}
                    </TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      {canManage ? (
                        <RoleSelect
                          teamId={currentTeam.id}
                          userId={member.user_id}
                          currentRole={member.role}
                          actorRole={currentRole}
                          onChanged={() => mutate()}
                        />
                      ) : (
                        <Badge variant={roleBadgeVariant(member.role)}>
                          {member.role}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(member.joined_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {isSelf ? (
                        <LeaveButton
                          teamId={currentTeam.id}
                          disabled={isSoleOwner}
                          onLeft={() => { mutateUser(); router.push("/dashboard"); }}
                        />
                      ) : canManage ? (
                        <RemoveMemberButton
                          teamId={currentTeam.id}
                          userId={member.user_id}
                          memberName={member.name || member.email}
                          onRemoved={() => mutate()}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Settings section */}
      {isAdmin && (
        <TeamSettings
          teamId={currentTeam.id}
          teamName={teamDetail?.name ?? currentTeam.name}
          isOwner={isOwner}
          isSingleTeam={teams.length <= 1}
          onRenamed={() => { mutate(); mutateUser(); }}
          onDeleted={() => { mutateUser(); router.push("/dashboard"); }}
        />
      )}
    </div>
  );
}

// --- Role Select ---

function RoleSelect({
  teamId,
  userId,
  currentRole,
  actorRole,
  onChanged,
}: {
  teamId: string;
  userId: string;
  currentRole: TeamRole;
  actorRole: TeamRole;
  onChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleChange(newRole: string) {
    if (newRole === currentRole) return;
    setLoading(true);
    try {
      await api.patch(`/v1/teams/${teamId}/members/${userId}`, { role: newRole });
      onChanged();
    } catch {
      // Silently fail — role will revert on next render
    } finally {
      setLoading(false);
    }
  }

  return (
    <Select value={currentRole} onValueChange={handleChange} disabled={loading}>
      <SelectTrigger className="w-[120px] h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {assignableRoles(actorRole).map((role) => (
          <SelectItem key={role} value={role}>
            {role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// --- Invite Member Dialog ---

function InviteMemberDialog({
  teamId,
  currentRole,
  onInvited,
}: {
  teamId: string;
  currentRole: TeamRole;
  onInvited: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function resetAndClose() {
    setOpen(false);
    setEmail("");
    setRole("member");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post(`/v1/teams/${teamId}/members`, { email, role });
      resetAndClose();
      onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to invite member");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button size="sm">Invite Member</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
          <DialogDescription>
            Add a new member to the team by email address.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">member</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
                {currentRole === "owner" && (
                  <SelectItem value="owner">owner</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Inviting..." : "Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Remove Member Button ---

function RemoveMemberButton({
  teamId,
  userId,
  memberName,
  onRemoved,
}: {
  teamId: string;
  userId: string;
  memberName: string;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRemove() {
    setLoading(true);
    try {
      await api.delete(`/v1/teams/${teamId}/members/${userId}`);
      setOpen(false);
      onRemoved();
    } catch {
      // Error handling — dialog stays open
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove Member</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove {memberName} from the team?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleRemove} disabled={loading}>
            {loading ? "Removing..." : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Leave Button ---

function LeaveButton({
  teamId,
  disabled,
  onLeft,
}: {
  teamId: string;
  disabled: boolean;
  onLeft: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user } = useUser();

  async function handleLeave() {
    if (!user) return;
    setLoading(true);
    try {
      await api.delete(`/v1/teams/${teamId}/members/${user.id}`);
      setOpen(false);
      onLeft();
    } catch {
      // Error handling
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" disabled={disabled} title={disabled ? "Cannot leave — you are the sole owner" : "Leave team"}>
          <LogOut className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave Team</DialogTitle>
          <DialogDescription>
            Are you sure you want to leave this team? You will lose access to all team resources.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleLeave} disabled={loading}>
            {loading ? "Leaving..." : "Leave"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Team Settings ---

function TeamSettings({
  teamId,
  teamName,
  isOwner,
  isSingleTeam,
  onRenamed,
  onDeleted,
}: {
  teamId: string;
  teamName: string;
  isOwner: boolean;
  isSingleTeam: boolean;
  onRenamed: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(teamName);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (name === teamName || !name.trim()) return;
    setRenameError("");
    setRenameLoading(true);
    try {
      await api.patch(`/v1/teams/${teamId}`, { name: name.trim() });
      onRenamed();
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : "Failed to rename team");
    } finally {
      setRenameLoading(false);
    }
  }

  async function handleDelete() {
    setDeleteLoading(true);
    try {
      await api.delete(`/v1/teams/${teamId}`);
      setDeleteOpen(false);
      onDeleted();
    } catch {
      // Error handling
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleRename} className="flex items-end gap-3">
          <div className="space-y-2 flex-1">
            <Label htmlFor="team-name">Team name</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={renameLoading || name === teamName || !name.trim()}>
            {renameLoading ? "Saving..." : "Save"}
          </Button>
        </form>
        {renameError && <p className="text-sm text-destructive">{renameError}</p>}

        {isOwner && (
          <div className="border-t pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Delete team</p>
                <p className="text-sm text-muted-foreground">
                  Permanently delete this team and all its data.
                </p>
              </div>
              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" disabled={isSingleTeam} title={isSingleTeam ? "Cannot delete your only team" : undefined}>
                    Delete Team
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Team</DialogTitle>
                    <DialogDescription>
                      This will permanently delete the team and all associated projects, apps, and data. This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
                      {deleteLoading ? "Deleting..." : "Delete Team"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
