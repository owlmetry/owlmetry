import { and, eq, isNull } from "drizzle-orm";
import { projects } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import { PROJECT_COLORS } from "@owlmetry/shared";

export async function pickUnusedProjectColor(db: Db, team_id: string): Promise<string> {
  const rows = await db
    .select({ color: projects.color })
    .from(projects)
    .where(and(eq(projects.team_id, team_id), isNull(projects.deleted_at)));

  const used = new Set(rows.map((r) => r.color));
  const available = PROJECT_COLORS.filter((c) => !used.has(c));
  const pool = available.length > 0 ? available : PROJECT_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}
