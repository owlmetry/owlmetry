import { eq } from "drizzle-orm";
import { teamMembers } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";

/** All user_ids who are members of a team, including owners and admins. */
export async function resolveTeamMemberUserIds(db: Db, teamId: string): Promise<string[]> {
  const rows = await db
    .select({ user_id: teamMembers.user_id })
    .from(teamMembers)
    .where(eq(teamMembers.team_id, teamId));
  return rows.map((r) => r.user_id);
}
