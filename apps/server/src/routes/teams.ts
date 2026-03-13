import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, and, count } from "drizzle-orm";
import { teams, teamMembers, users } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { canManageRole, VALID_TEAM_ROLES, SLUG_REGEX, PG_UNIQUE_VIOLATION } from "@owlmetry/shared";
import type {
  TeamRole,
  CreateTeamRequest,
  UpdateTeamRequest,
  AddTeamMemberRequest,
  UpdateTeamMemberRoleRequest,
} from "@owlmetry/shared";
import { requireAuth, getTeamRole, assertTeamRole } from "../middleware/auth.js";
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

      const [teamRows, members] = await Promise.all([
        app.db.select().from(teams).where(eq(teams.id, teamId)).limit(1),
        getTeamMembers(app.db, teamId),
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

      const [updated] = await app.db
        .update(teams)
        .set({ name, updated_at: new Date() })
        .where(eq(teams.id, teamId))
        .returning();

      if (!updated) {
        return reply.code(404).send({ error: "Team not found" });
      }

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

      const [deleted] = await app.db
        .delete(teams)
        .where(eq(teams.id, teamId))
        .returning({ id: teams.id });

      if (!deleted) {
        return reply.code(404).send({ error: "Team not found" });
      }

      return { deleted: true };
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

  // Add member by email
  app.post<{ Params: { teamId: string }; Body: AddTeamMemberRequest }>(
    "/teams/:teamId/members",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can add team members" });
      }

      const roleError = assertTeamRole(auth, teamId, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      const { email, role: requestedRole } = request.body;
      const targetRole: TeamRole = requestedRole || "member";

      if (!email) {
        return reply.code(400).send({ error: "email is required" });
      }

      if (!(VALID_TEAM_ROLES as readonly string[]).includes(targetRole)) {
        return reply.code(400).send({ error: "Invalid role" });
      }

      // Only owners can add someone as owner
      const actorRole = getTeamRole(auth, teamId)!;
      if (targetRole === "owner" && actorRole !== "owner") {
        return reply.code(403).send({ error: "Only owners can add members as owner" });
      }

      // Look up user by email
      const [targetUser] = await app.db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!targetUser) {
        return reply.code(404).send({ error: "No user found with that email" });
      }

      try {
        const [member] = await app.db.insert(teamMembers).values({
          team_id: teamId,
          user_id: targetUser.id,
          role: targetRole,
        }).returning({ joined_at: teamMembers.joined_at });

        return reply.code(201).send({
          user_id: targetUser.id,
          email: targetUser.email,
          name: targetUser.name,
          role: targetRole,
          joined_at: member.joined_at.toISOString(),
        });
      } catch (err: any) {
        if (err.code === PG_UNIQUE_VIOLATION) {
          return reply.code(409).send({ error: "User is already a member of this team" });
        }
        throw err;
      }
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

      return {
        user_id: updated.user_id,
        role: updated.role,
      };
    }
  );

  // Remove member
  app.delete<{ Params: { teamId: string; userId: string } }>(
    "/teams/:teamId/members/:userId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId, userId } = request.params;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can remove team members" });
      }

      // Self-removal (leave team) — any role can do this
      if (userId === auth.user_id) {
        return handleLeaveTeam(app, auth, teamId, reply);
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

      return { removed: true };
    }
  );
}

async function handleLeaveTeam(
  app: FastifyInstance,
  auth: UserContext,
  teamId: string,
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

  return { removed: true };
}
