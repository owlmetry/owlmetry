import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, and, count, isNull, inArray } from "drizzle-orm";
import { teams, teamMembers, users, apiKeys, auditLogs, projects, apps, metricDefinitions, funnelDefinitions, teamInvitations } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { canManageRole, VALID_TEAM_ROLES, SLUG_REGEX, PG_UNIQUE_VIOLATION } from "@owlmetry/shared";
import type {
  TeamRole,
  CreateTeamRequest,
  UpdateTeamRequest,
  UpdateTeamMemberRoleRequest,
} from "@owlmetry/shared";
import { requireAuth, getTeamRole, assertTeamRole } from "../middleware/auth.js";
import { getPendingInvitations } from "./invitations.js";
import { logAuditEvent } from "../utils/audit.js";
import type { UserContext } from "../types.js";

async function getTeamMembers(db: Db, teamId: string) {
  const rows = await db
    .select({
      user_id: teamMembers.user_id,
      role: teamMembers.role,
      email: users.email,
      name: users.name,
      joined_at: teamMembers.joined_at,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.user_id))
    .where(eq(teamMembers.team_id, teamId));

  return rows.map((r) => ({
    user_id: r.user_id,
    email: r.email,
    name: r.name,
    role: r.role,
    joined_at: r.joined_at.toISOString(),
  }));
}

async function isLastOwner(db: Db, teamId: string): Promise<boolean> {
  const [result] = await db
    .select({ count: count() })
    .from(teamMembers)
    .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.role, "owner")));
  return result.count <= 1;
}

export async function teamsRoutes(app: FastifyInstance) {
  // Create team
  app.post<{ Body: CreateTeamRequest }>(
    "/teams",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can create teams" });
      }

      const { name, slug } = request.body;

      if (!name || !slug) {
        return reply.code(400).send({ error: "name and slug are required" });
      }

      if (!SLUG_REGEX.test(slug)) {
        return reply
          .code(400)
          .send({ error: "slug must contain only lowercase letters, numbers, and hyphens" });
      }

      try {
        const team = await app.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(teams)
            .values({ name, slug })
            .returning();

          await tx.insert(teamMembers).values({
            team_id: created.id,
            user_id: auth.user_id,
            role: "owner",
          });

          return created;
        });

        logAuditEvent(app.db, auth, {
          team_id: team.id,
          action: "create",
          resource_type: "team",
          resource_id: team.id,
          metadata: { name, slug },
        });
        logAuditEvent(app.db, auth, {
          team_id: team.id,
          action: "create",
          resource_type: "team_member",
          resource_id: auth.user_id,
          metadata: { role: "owner" },
        });

        return reply.code(201).send({
          id: team.id,
          name: team.name,
          slug: team.slug,
          created_at: team.created_at.toISOString(),
          updated_at: team.updated_at.toISOString(),
        });
      } catch (err: any) {
        if (err.code === PG_UNIQUE_VIOLATION) {
          return reply.code(409).send({ error: "A team with this slug already exists" });
        }
        throw err;
      }
    }
  );

  // Get team details with members
  app.get<{ Params: { teamId: string } }>(
    "/teams/:teamId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;

      const roleError = assertTeamRole(auth, teamId, "member");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      const [teamRows, members, pendingInvitations] = await Promise.all([
        app.db.select().from(teams).where(and(eq(teams.id, teamId), isNull(teams.deleted_at))).limit(1),
        getTeamMembers(app.db, teamId),
        getPendingInvitations(app.db, teamId),
      ]);

      const team = teamRows[0];
      if (!team) {
        return reply.code(404).send({ error: "Team not found" });
      }

      return {
        id: team.id,
        name: team.name,
        slug: team.slug,
        created_at: team.created_at.toISOString(),
        updated_at: team.updated_at.toISOString(),
        members,
        pending_invitations: pendingInvitations,
      };
    }
  );

  // Rename team
  app.patch<{ Params: { teamId: string }; Body: UpdateTeamRequest }>(
    "/teams/:teamId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can update teams" });
      }

      const roleError = assertTeamRole(auth, teamId, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      const { name } = request.body;
      if (!name) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      // Fetch current name for audit
      const [current] = await app.db
        .select({ name: teams.name })
        .from(teams)
        .where(and(eq(teams.id, teamId), isNull(teams.deleted_at)))
        .limit(1);

      if (!current) {
        return reply.code(404).send({ error: "Team not found" });
      }

      const [updated] = await app.db
        .update(teams)
        .set({ name })
        .where(and(eq(teams.id, teamId), isNull(teams.deleted_at)))
        .returning();

      if (!updated) {
        return reply.code(404).send({ error: "Team not found" });
      }

      logAuditEvent(app.db, auth, {
        team_id: teamId,
        action: "update",
        resource_type: "team",
        resource_id: teamId,
        changes: { name: { before: current?.name, after: name } },
      });

      return {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        created_at: updated.created_at.toISOString(),
        updated_at: updated.updated_at.toISOString(),
      };
    }
  );

  // Delete team
  app.delete<{ Params: { teamId: string } }>(
    "/teams/:teamId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete teams" });
      }

      const roleError = assertTeamRole(auth, teamId, "owner");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      // Don't let users delete their only team
      if (auth.team_memberships.length <= 1) {
        return reply.code(400).send({ error: "Cannot delete your only team" });
      }

      const now = new Date();

      // Soft-delete team and cascade to all children in a transaction
      const result = await app.db.transaction(async (tx) => {
        // Soft-delete the team
        const [team] = await tx
          .update(teams)
          .set({ deleted_at: now })
          .where(and(eq(teams.id, teamId), isNull(teams.deleted_at)))
          .returning({ id: teams.id });

        if (!team) return null;

        // Find project IDs for cascading to definitions
        const teamProjects = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.team_id, teamId), isNull(projects.deleted_at)));
        const projectIds = teamProjects.map((p) => p.id);

        // Soft-delete children
        await tx
          .update(projects)
          .set({ deleted_at: now })
          .where(and(eq(projects.team_id, teamId), isNull(projects.deleted_at)));

        await tx
          .update(apps)
          .set({ deleted_at: now })
          .where(and(eq(apps.team_id, teamId), isNull(apps.deleted_at)));

        await tx
          .update(apiKeys)
          .set({ deleted_at: now })
          .where(and(eq(apiKeys.team_id, teamId), isNull(apiKeys.deleted_at)));

        if (projectIds.length > 0) {
          await tx
            .update(metricDefinitions)
            .set({ deleted_at: now })
            .where(and(inArray(metricDefinitions.project_id, projectIds), isNull(metricDefinitions.deleted_at)));

          await tx
            .update(funnelDefinitions)
            .set({ deleted_at: now })
            .where(and(inArray(funnelDefinitions.project_id, projectIds), isNull(funnelDefinitions.deleted_at)));
        }

        // Hard-delete team_members (removes access immediately)
        await tx
          .delete(teamMembers)
          .where(eq(teamMembers.team_id, teamId));

        // Hard-delete pending invitations
        await tx
          .delete(teamInvitations)
          .where(eq(teamInvitations.team_id, teamId));

        return team;
      });

      if (!result) {
        return reply.code(404).send({ error: "Team not found" });
      }

      logAuditEvent(app.db, auth, {
        team_id: teamId,
        action: "delete",
        resource_type: "team",
        resource_id: teamId,
      });

      return { deleted: true };
    }
  );

  // List agent keys for a specific member
  app.get<{ Params: { teamId: string; userId: string } }>(
    "/teams/:teamId/members/:userId/agent-keys",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId, userId } = request.params;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can view member agent keys" });
      }

      // Allow admin+ or self (self only needs member)
      const requiredRole = auth.user_id === userId ? "member" : "admin";
      const roleError = assertTeamRole(auth, teamId, requiredRole);
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      const keys = await app.db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          key_prefix: apiKeys.key_prefix,
          permissions: apiKeys.permissions,
          created_at: apiKeys.created_at,
        })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.team_id, teamId),
            eq(apiKeys.created_by, userId),
            eq(apiKeys.key_type, "agent"),
            isNull(apiKeys.deleted_at)
          )
        );

      return {
        keys: keys.map((k) => ({
          id: k.id,
          name: k.name,
          key_prefix: k.key_prefix,
          permissions: k.permissions,
          created_at: k.created_at.toISOString(),
        })),
      };
    }
  );

  // List team members
  app.get<{ Params: { teamId: string } }>(
    "/teams/:teamId/members",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;

      const roleError = assertTeamRole(auth, teamId, "member");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      return { members: await getTeamMembers(app.db, teamId) };
    }
  );

  // Change member role
  app.patch<{ Params: { teamId: string; userId: string }; Body: UpdateTeamMemberRoleRequest }>(
    "/teams/:teamId/members/:userId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId, userId } = request.params;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can change member roles" });
      }

      const roleError = assertTeamRole(auth, teamId, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      const { role: newRole } = request.body;

      if (!newRole || !(VALID_TEAM_ROLES as readonly string[]).includes(newRole)) {
        return reply.code(400).send({ error: "A valid role is required" });
      }

      if (userId === auth.user_id) {
        return reply.code(400).send({ error: "Cannot change your own role" });
      }

      const actorRole = getTeamRole(auth, teamId)!;

      // Only owners can promote to owner
      if (newRole === "owner" && actorRole !== "owner") {
        return reply.code(403).send({ error: "Only owners can promote members to owner" });
      }

      // Load target's current membership
      const [target] = await app.db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)))
        .limit(1);

      if (!target) {
        return reply.code(404).send({ error: "Member not found" });
      }

      // Owners can manage anyone; admins can only manage members (lower role)
      if (actorRole !== "owner" && !canManageRole(actorRole, target.role)) {
        return reply.code(403).send({ error: "Cannot change the role of a member with equal or higher role" });
      }

      // Prevent demoting the last owner
      if (target.role === "owner" && newRole !== "owner") {
        if (await isLastOwner(app.db, teamId)) {
          return reply.code(400).send({ error: "Cannot demote the last owner" });
        }
      }

      const [updated] = await app.db
        .update(teamMembers)
        .set({ role: newRole })
        .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)))
        .returning();

      logAuditEvent(app.db, auth, {
        team_id: teamId,
        action: "update",
        resource_type: "team_member",
        resource_id: userId,
        changes: { role: { before: target.role, after: newRole } },
      });

      return {
        user_id: updated.user_id,
        role: updated.role,
      };
    }
  );

  // Remove member
  app.delete<{ Params: { teamId: string; userId: string }; Querystring: { revoke_agent_keys?: string } }>(
    "/teams/:teamId/members/:userId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId, userId } = request.params;
      const revokeAgentKeys = request.query.revoke_agent_keys === "true";

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can remove team members" });
      }

      // Self-removal (leave team) — any role can do this
      if (userId === auth.user_id) {
        return handleLeaveTeam(app, auth, teamId, revokeAgentKeys, reply);
      }

      const roleError = assertTeamRole(auth, teamId, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      const actorRole = getTeamRole(auth, teamId)!;

      // Load target's current membership
      const [target] = await app.db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)))
        .limit(1);

      if (!target) {
        return reply.code(404).send({ error: "Member not found" });
      }

      // Owners can remove anyone; admins can only remove members (lower role)
      if (actorRole !== "owner" && !canManageRole(actorRole, target.role)) {
        return reply.code(403).send({ error: "Cannot remove a member with equal or higher role" });
      }

      await app.db
        .delete(teamMembers)
        .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)));

      logAuditEvent(app.db, auth, {
        team_id: teamId,
        action: "delete",
        resource_type: "team_member",
        resource_id: userId,
      });

      let revokedCount = 0;
      if (revokeAgentKeys) {
        revokedCount = await revokeUserAgentKeys(app, auth, teamId, userId);
      }

      return { removed: true, revoked_agent_keys: revokedCount };
    }
  );
}

async function handleLeaveTeam(
  app: FastifyInstance,
  auth: UserContext,
  teamId: string,
  revokeAgentKeys: boolean,
  reply: FastifyReply
) {
  const role = getTeamRole(auth, teamId);
  if (!role) {
    return reply.code(403).send({ error: "Not a member of this team" });
  }

  if (role === "owner" && await isLastOwner(app.db, teamId)) {
    return reply.code(400).send({ error: "Transfer ownership before leaving — you are the sole owner" });
  }

  await app.db
    .delete(teamMembers)
    .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, auth.user_id)));

  let revokedCount = 0;
  if (revokeAgentKeys) {
    revokedCount = await revokeUserAgentKeys(app, auth, teamId, auth.user_id);
  }

  return { removed: true, revoked_agent_keys: revokedCount };
}

async function revokeUserAgentKeys(
  app: FastifyInstance,
  auth: UserContext,
  teamId: string,
  userId: string
): Promise<number> {
  const revoked = await app.db
    .update(apiKeys)
    .set({ deleted_at: new Date() })
    .where(
      and(
        eq(apiKeys.team_id, teamId),
        eq(apiKeys.created_by, userId),
        eq(apiKeys.key_type, "agent"),
        isNull(apiKeys.deleted_at)
      )
    )
    .returning({ id: apiKeys.id });

  if (revoked.length > 0) {
    app.db
      .insert(auditLogs)
      .values(
        revoked.map((key) => ({
          team_id: teamId,
          actor_type: "user" as const,
          actor_id: auth.user_id,
          action: "delete" as const,
          resource_type: "api_key" as const,
          resource_id: key.id,
        }))
      )
      .execute()
      .catch(() => {});
  }

  return revoked.length;
}
