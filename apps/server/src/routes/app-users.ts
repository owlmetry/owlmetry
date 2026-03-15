import type { FastifyInstance } from "fastify";
import { and, eq, lt, desc, inArray, isNull, ilike } from "drizzle-orm";
import { apps, appUsers } from "@owlmetry/db";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@owlmetry/shared";
import type { AppUsersQueryParams } from "@owlmetry/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { serializeAppUser } from "../utils/serialize.js";

export async function appUsersRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: AppUsersQueryParams }>(
    "/apps/:id/users",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;
      const { search, is_anonymous, cursor, limit: rawLimit } = request.query;

      const limit = Math.min(
        Math.max(Number(rawLimit) || DEFAULT_PAGE_SIZE, 1),
        MAX_PAGE_SIZE
      );

      // Verify app exists and belongs to caller's team
      const teamIds = getAuthTeamIds(auth);
      const [appRow] = await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(
          and(eq(apps.id, id), inArray(apps.team_id, teamIds), isNull(apps.deleted_at))
        )
        .limit(1);

      if (!appRow) {
        return reply.code(404).send({ error: "App not found" });
      }

      const conditions = [eq(appUsers.app_id, id)];

      if (is_anonymous === "true") {
        conditions.push(eq(appUsers.is_anonymous, true));
      } else if (is_anonymous === "false") {
        conditions.push(eq(appUsers.is_anonymous, false));
      }

      if (search) {
        conditions.push(ilike(appUsers.user_id, `%${search}%`));
      }

      if (cursor) {
        conditions.push(lt(appUsers.last_seen_at, new Date(cursor)));
      }

      const rows = await app.db
        .select()
        .from(appUsers)
        .where(and(...conditions))
        .orderBy(desc(appUsers.last_seen_at))
        .limit(limit + 1);

      const has_more = rows.length > limit;
      const page = has_more ? rows.slice(0, limit) : rows;

      return {
        users: page.map(serializeAppUser),
        cursor: has_more
          ? page[page.length - 1].last_seen_at.toISOString()
          : null,
        has_more,
      };
    }
  );
}
