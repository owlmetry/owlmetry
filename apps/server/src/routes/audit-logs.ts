import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, desc, lt, or } from "drizzle-orm";
import { auditLogs } from "@owlmetry/db";
import { AUDIT_ACTIONS, parseTimeParam } from "@owlmetry/shared";
import type { AuditLogsQueryParams, AuditAction } from "@owlmetry/shared";
import { requirePermission, assertTeamRole, hasTeamAccess } from "../middleware/auth.js";
import { serializeAuditLog } from "../utils/serialize.js";
import { normalizeLimit } from "../utils/pagination.js";

export async function auditLogsRoutes(app: FastifyInstance) {
  app.get<{ Params: { teamId: string }; Querystring: AuditLogsQueryParams }>(
    "/audit-logs",
    { preHandler: requirePermission("audit_logs:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;
      const { resource_type, resource_id, actor_id, action, since, until, cursor, limit: limitStr } = request.query;

      if (!hasTeamAccess(auth, teamId)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      // Users need admin role minimum
      if (auth.type === "user") {
        const roleError = assertTeamRole(auth, teamId, "admin");
        if (roleError) {
          return reply.code(403).send({ error: roleError });
        }
      }

      const limit = normalizeLimit(limitStr);

      const conditions = [eq(auditLogs.team_id, teamId)];

      if (resource_type) conditions.push(eq(auditLogs.resource_type, resource_type));
      if (resource_id) conditions.push(eq(auditLogs.resource_id, resource_id));
      if (actor_id) conditions.push(eq(auditLogs.actor_id, actor_id));
      if (action && AUDIT_ACTIONS.includes(action as AuditAction)) {
        conditions.push(eq(auditLogs.action, action as AuditAction));
      }
      if (since) conditions.push(gte(auditLogs.timestamp, parseTimeParam(since)));
      if (until) conditions.push(lte(auditLogs.timestamp, parseTimeParam(until)));

      // Cursor-based pagination: cursor is "timestamp|id"
      if (cursor) {
        const [cursorTs, cursorId] = cursor.split("|");
        if (cursorTs && cursorId) {
          const cursorDate = new Date(cursorTs);
          conditions.push(
            or(
              lt(auditLogs.timestamp, cursorDate),
              and(eq(auditLogs.timestamp, cursorDate), lt(auditLogs.id, cursorId)),
            )!,
          );
        }
      }

      const rows = await app.db
        .select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.timestamp), desc(auditLogs.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = pageRows[pageRows.length - 1];
      const nextCursor = hasMore && lastRow
        ? `${lastRow.timestamp.toISOString()}|${lastRow.id}`
        : null;

      return {
        audit_logs: pageRows.map(serializeAuditLog),
        cursor: nextCursor,
        has_more: hasMore,
      };
    },
  );
}
