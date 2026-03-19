import type { FastifyInstance } from "fastify";
import { eq, and, isNull, gt } from "drizzle-orm";
import { teamInvitations, teams, teamMembers, users } from "@owlmetry/db";
import { VALID_TEAM_ROLES, PG_UNIQUE_VIOLATION } from "@owlmetry/shared";
import type {
  TeamRole,
  CreateTeamInvitationRequest,
  AcceptInvitationRequest,
  TeamInvitationResponse,
} from "@owlmetry/shared";
import { requireAuth, getTeamRole, assertTeamRole } from "../middleware/auth.js";
import { config } from "../config.js";

const INVITATION_EXPIRY_DAYS = 7;

function invitationExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + INVITATION_EXPIRY_DAYS);
  return d;
}

async function getPendingInvitations(
  db: FastifyInstance["db"],
  teamId: string
): Promise<TeamInvitationResponse[]> {
  const rows = await db
    .select({
      id: teamInvitations.id,
      team_id: teamInvitations.team_id,
      email: teamInvitations.email,
      role: teamInvitations.role,
      invited_by_user_id: teamInvitations.invited_by_user_id,
      inviter_name: users.name,
      inviter_email: users.email,
      expires_at: teamInvitations.expires_at,
      accepted_at: teamInvitations.accepted_at,
      created_at: teamInvitations.created_at,
    })
    .from(teamInvitations)
    .innerJoin(users, eq(users.id, teamInvitations.invited_by_user_id))
    .where(
      and(
        eq(teamInvitations.team_id, teamId),
        isNull(teamInvitations.accepted_at),
        gt(teamInvitations.expires_at, new Date())
      )
    );

  return rows.map((r) => ({
    id: r.id,
    team_id: r.team_id,
    email: r.email,
    role: r.role,
    invited_by: {
      user_id: r.invited_by_user_id,
      name: r.inviter_name,
      email: r.inviter_email,
    },
    expires_at: r.expires_at.toISOString(),
    accepted_at: null,
    created_at: r.created_at.toISOString(),
  }));
}

export async function invitationRoutes(app: FastifyInstance) {
  // Create / resend invitation
  app.post<{ Params: { teamId: string }; Body: CreateTeamInvitationRequest }>(
    "/teams/:teamId/invitations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can send invitations" });
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

      // Only owners can invite as owner
      const actorRole = getTeamRole(auth, teamId)!;
      if (targetRole === "owner" && actorRole !== "owner") {
        return reply.code(403).send({ error: "Only owners can invite members as owner" });
      }

      // Check if already a team member
      const existingMember = await app.db
        .select({ user_id: users.id })
        .from(users)
        .innerJoin(
          teamMembers,
          and(eq(teamMembers.user_id, users.id), eq(teamMembers.team_id, teamId))
        )
        .where(eq(users.email, email))
        .limit(1);

      if (existingMember.length > 0) {
        return reply.code(409).send({ error: "User is already a member of this team" });
      }

      // Get team name for email
      const [team] = await app.db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        return reply.code(404).send({ error: "Team not found" });
      }

      // Get inviter name
      const [inviter] = await app.db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, auth.user_id))
        .limit(1);

      const expiresAt = invitationExpiresAt();

      // Upsert: on re-invite, regenerate token + reset expiry
      let invitation;
      try {
        const [existing] = await app.db
          .select()
          .from(teamInvitations)
          .where(
            and(
              eq(teamInvitations.team_id, teamId),
              eq(teamInvitations.email, email)
            )
          )
          .limit(1);

        if (existing && !existing.accepted_at) {
          // Re-invite: update token, role, expiry
          const [updated] = await app.db
            .update(teamInvitations)
            .set({
              token: crypto.randomUUID(),
              role: targetRole,
              invited_by_user_id: auth.user_id,
              expires_at: expiresAt,
            })
            .where(eq(teamInvitations.id, existing.id))
            .returning();
          invitation = updated;
        } else if (existing && existing.accepted_at) {
          // Already accepted — they're somehow not a member but accepted before
          // Delete stale record and create fresh
          await app.db
            .delete(teamInvitations)
            .where(eq(teamInvitations.id, existing.id));
          const [created] = await app.db
            .insert(teamInvitations)
            .values({
              team_id: teamId,
              email,
              role: targetRole,
              invited_by_user_id: auth.user_id,
              expires_at: expiresAt,
            })
            .returning();
          invitation = created;
        } else {
          const [created] = await app.db
            .insert(teamInvitations)
            .values({
              team_id: teamId,
              email,
              role: targetRole,
              invited_by_user_id: auth.user_id,
              expires_at: expiresAt,
            })
            .returning();
          invitation = created;
        }
      } catch (err: any) {
        if (err.code === PG_UNIQUE_VIOLATION) {
          return reply.code(409).send({ error: "An invitation for this email already exists" });
        }
        throw err;
      }

      // Send email
      const acceptUrl = `${config.webAppUrl}/invite/accept?token=${invitation.token}`;
      await app.emailService.sendTeamInvitation(email, {
        team_name: team.name,
        invited_by_name: inviter.name,
        role: targetRole,
        accept_url: acceptUrl,
      });

      return reply.code(201).send({
        id: invitation.id,
        team_id: invitation.team_id,
        email: invitation.email,
        role: invitation.role,
        invited_by: {
          user_id: auth.user_id,
          name: inviter.name,
          email: inviter.email,
        },
        expires_at: invitation.expires_at.toISOString(),
        accepted_at: null,
        created_at: invitation.created_at.toISOString(),
      });
    }
  );

  // List pending invitations for a team
  app.get<{ Params: { teamId: string } }>(
    "/teams/:teamId/invitations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;

      const roleError = assertTeamRole(auth, teamId, "member");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      return { invitations: await getPendingInvitations(app.db, teamId) };
    }
  );

  // Revoke invitation
  app.delete<{ Params: { teamId: string; invitationId: string } }>(
    "/teams/:teamId/invitations/:invitationId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId, invitationId } = request.params;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can revoke invitations" });
      }

      const roleError = assertTeamRole(auth, teamId, "admin");
      if (roleError) {
        return reply.code(403).send({ error: roleError });
      }

      const [deleted] = await app.db
        .delete(teamInvitations)
        .where(
          and(
            eq(teamInvitations.id, invitationId),
            eq(teamInvitations.team_id, teamId)
          )
        )
        .returning({ id: teamInvitations.id });

      if (!deleted) {
        return reply.code(404).send({ error: "Invitation not found" });
      }

      return { deleted: true };
    }
  );

  // Public invite info (no auth required)
  app.get<{ Params: { token: string } }>(
    "/invites/:token",
    async (request, reply) => {
      const { token } = request.params;

      const rows = await app.db
        .select({
          email: teamInvitations.email,
          role: teamInvitations.role,
          expires_at: teamInvitations.expires_at,
          accepted_at: teamInvitations.accepted_at,
          team_name: teams.name,
          team_slug: teams.slug,
          inviter_name: users.name,
        })
        .from(teamInvitations)
        .innerJoin(teams, eq(teams.id, teamInvitations.team_id))
        .innerJoin(users, eq(users.id, teamInvitations.invited_by_user_id))
        .where(eq(teamInvitations.token, token))
        .limit(1);

      if (rows.length === 0) {
        return reply.code(404).send({ error: "Invitation not found" });
      }

      const inv = rows[0];

      if (inv.accepted_at) {
        return reply.code(410).send({ error: "This invitation has already been accepted" });
      }

      if (inv.expires_at < new Date()) {
        return reply.code(410).send({ error: "This invitation has expired" });
      }

      return {
        team_name: inv.team_name,
        team_slug: inv.team_slug,
        role: inv.role,
        email: inv.email,
        invited_by_name: inv.inviter_name,
        expires_at: inv.expires_at.toISOString(),
      };
    }
  );

  // Accept invitation (auth required)
  app.post<{ Body: AcceptInvitationRequest }>(
    "/invites/accept",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can accept invitations" });
      }

      const { token } = request.body;

      if (!token) {
        return reply.code(400).send({ error: "token is required" });
      }

      const rows = await app.db
        .select({
          id: teamInvitations.id,
          team_id: teamInvitations.team_id,
          email: teamInvitations.email,
          role: teamInvitations.role,
          expires_at: teamInvitations.expires_at,
          accepted_at: teamInvitations.accepted_at,
          team_name: teams.name,
        })
        .from(teamInvitations)
        .innerJoin(teams, eq(teams.id, teamInvitations.team_id))
        .where(eq(teamInvitations.token, token))
        .limit(1);

      if (rows.length === 0) {
        return reply.code(404).send({ error: "Invitation not found" });
      }

      const inv = rows[0];

      if (inv.accepted_at) {
        return reply.code(410).send({ error: "This invitation has already been accepted" });
      }

      if (inv.expires_at < new Date()) {
        return reply.code(410).send({ error: "This invitation has expired" });
      }

      if (inv.email !== auth.email) {
        return reply.code(403).send({
          error: `This invitation was sent to ${inv.email}. You are signed in as ${auth.email}.`,
        });
      }

      // Transaction: insert team member + mark accepted
      try {
        await app.db.transaction(async (tx) => {
          await tx.insert(teamMembers).values({
            team_id: inv.team_id,
            user_id: auth.user_id,
            role: inv.role,
          });

          await tx
            .update(teamInvitations)
            .set({ accepted_at: new Date() })
            .where(eq(teamInvitations.id, inv.id));
        });
      } catch (err: any) {
        if (err.code === PG_UNIQUE_VIOLATION) {
          // Already a member — mark invitation as accepted anyway
          await app.db
            .update(teamInvitations)
            .set({ accepted_at: new Date() })
            .where(eq(teamInvitations.id, inv.id));
        } else {
          throw err;
        }
      }

      return {
        team_id: inv.team_id,
        team_name: inv.team_name,
        role: inv.role,
      };
    }
  );
}

export { getPendingInvitations };
