import postgres from "postgres";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

/**
 * One-off repair for the pre-fix race where offline-queued events flushed
 * after /v1/identity/claim landed under the anon id. After deploying the
 * ingest-side claimed_from rewrite, run this to clean up historical rows.
 *
 * For every (project_id, anon_id, real_user_id) triple derivable from
 * app_users.claimed_from:
 *   1. Reassign events / funnel_events / metric_events / event_attachments
 *      user_id anon_id → real_user_id (scoped to the project's apps).
 *   2. Merge app_user_apps junction entries from the stranded anon row into
 *      the real user row, then delete the stranded anon row.
 *
 * Safe to re-run — each step is idempotent. Pass --dry-run to preview.
 */

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const triples = await sql<
      Array<{ project_id: string; anon_id: string; real_user_id: string }>
    >`
      SELECT
        project_id,
        jsonb_array_elements_text(claimed_from) AS anon_id,
        user_id AS real_user_id
      FROM app_users
      WHERE claimed_from IS NOT NULL
        AND jsonb_typeof(claimed_from) = 'array'
    `;

    console.log(`Found ${triples.length} claimed (anon → real) mappings across all projects.`);
    if (triples.length === 0) {
      console.log("Nothing to do.");
      return;
    }

    let totalEvents = 0;
    let totalFunnelEvents = 0;
    let totalMetricEvents = 0;
    let totalAttachments = 0;
    let totalJunctionsMerged = 0;
    let totalStrandedDeleted = 0;

    await sql`BEGIN`;
    try {
      for (const { project_id, anon_id, real_user_id } of triples) {
        const projectApps = await sql<Array<{ id: string }>>`
          SELECT id FROM apps WHERE project_id = ${project_id} AND deleted_at IS NULL
        `;
        if (projectApps.length === 0) continue;
        const appIds = projectApps.map((a) => a.id);

        const eventsRes = await sql`
          UPDATE events SET user_id = ${real_user_id}
          WHERE app_id = ANY(${appIds}::uuid[]) AND user_id = ${anon_id}
        `;
        const funnelRes = await sql`
          UPDATE funnel_events SET user_id = ${real_user_id}
          WHERE app_id = ANY(${appIds}::uuid[]) AND user_id = ${anon_id}
        `;
        const metricRes = await sql`
          UPDATE metric_events SET user_id = ${real_user_id}
          WHERE app_id = ANY(${appIds}::uuid[]) AND user_id = ${anon_id}
        `;
        const attachRes = await sql`
          UPDATE event_attachments SET user_id = ${real_user_id}
          WHERE app_id = ANY(${appIds}::uuid[]) AND user_id = ${anon_id}
        `;

        totalEvents += eventsRes.count;
        totalFunnelEvents += funnelRes.count;
        totalMetricEvents += metricRes.count;
        totalAttachments += attachRes.count;

        const [stranded] = await sql<Array<{ id: string }>>`
          SELECT id FROM app_users
          WHERE project_id = ${project_id} AND user_id = ${anon_id}
          LIMIT 1
        `;
        if (stranded) {
          const [real] = await sql<Array<{ id: string }>>`
            SELECT id FROM app_users
            WHERE project_id = ${project_id} AND user_id = ${real_user_id}
            LIMIT 1
          `;
          if (real) {
            const merged = await sql`
              INSERT INTO app_user_apps (app_user_id, app_id, first_seen_at, last_seen_at)
              SELECT ${real.id}, app_id, first_seen_at, last_seen_at
              FROM app_user_apps WHERE app_user_id = ${stranded.id}
              ON CONFLICT (app_user_id, app_id) DO UPDATE SET
                first_seen_at = LEAST(app_user_apps.first_seen_at, EXCLUDED.first_seen_at),
                last_seen_at = GREATEST(app_user_apps.last_seen_at, EXCLUDED.last_seen_at)
            `;
            totalJunctionsMerged += merged.count;
          }
          const deleted = await sql`
            DELETE FROM app_users WHERE id = ${stranded.id}
          `;
          totalStrandedDeleted += deleted.count;
        }
      }

      if (DRY_RUN) {
        await sql`ROLLBACK`;
      } else {
        await sql`COMMIT`;
      }
    } catch (err) {
      await sql`ROLLBACK`;
      throw err;
    }

    console.log(`\nSummary${DRY_RUN ? " (dry run, rolled back)" : ""}:`);
    console.log(`  events reassigned:            ${totalEvents}`);
    console.log(`  funnel_events reassigned:     ${totalFunnelEvents}`);
    console.log(`  metric_events reassigned:     ${totalMetricEvents}`);
    console.log(`  event_attachments reassigned: ${totalAttachments}`);
    console.log(`  junction rows merged:         ${totalJunctionsMerged}`);
    console.log(`  stranded anon rows deleted:   ${totalStrandedDeleted}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
