import { createDatabaseConnection } from "./index.js";
import { apps, projects, users, issues, issueFingerprints, issueOccurrences, issueComments } from "./schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { generateIssueFingerprint } from "@owlmetry/shared";
import crypto from "node:crypto";
import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  console.error("Seed script is for development only. Aborting.");
  process.exit(1);
}

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

// ── Time helpers ──────────────────────────────────────────────────────

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ago(ms: number) {
  return new Date(NOW - ms);
}

// ── Issue definitions ─────────────────────────────────────────────────

type IssueDef = {
  title: string;
  sourceModule: string;
  appName: string; // "Demo App" or "Demo API Server"
  status: "new" | "in_progress" | "resolved" | "silenced" | "regressed";
  isDev: boolean;
  resolvedAtVersion?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrences: Array<{
    userId: string | null;
    appVersion: string;
    environment: "ios" | "ipados" | "macos" | "android" | "web" | "backend";
    timestampOffset: number; // ms before NOW
  }>;
  comments: Array<{
    authorType: "user" | "agent";
    body: string;
    createdOffset: number; // ms before NOW
  }>;
};

const ISSUE_DEFS: IssueDef[] = [
  // ── new ─────────────────────────────────────────────────────────────
  {
    title: "Failed to load profile image: 404",
    sourceModule: "ImageLoader",
    appName: "Demo App",
    status: "new",
    isDev: false,
    firstSeenAt: ago(7 * DAY),
    lastSeenAt: ago(1 * HOUR),
    occurrences: [
      { userId: "user-42", appVersion: "1.0.0", environment: "ios", timestampOffset: 7 * DAY },
      { userId: "user-42", appVersion: "1.0.1", environment: "ios", timestampOffset: 5 * DAY },
      { userId: "user-99", appVersion: "1.0.0", environment: "ios", timestampOffset: 4 * DAY },
      { userId: "user-150", appVersion: "1.1.0", environment: "ipados", timestampOffset: 3 * DAY },
      { userId: null, appVersion: "1.1.0", environment: "ios", timestampOffset: 2 * DAY },
      { userId: "user-1", appVersion: "1.1.0", environment: "ios", timestampOffset: 1 * DAY },
      { userId: "user-42", appVersion: "1.2.0", environment: "ios", timestampOffset: 6 * HOUR },
      { userId: "user-99", appVersion: "1.2.0", environment: "ios", timestampOffset: 1 * HOUR },
    ],
    comments: [
      {
        authorType: "agent",
        body: "This issue has been reported 8 times across 4 unique users. The error originates from ImageLoader when the CDN returns 404 for profile images. Most affected users are on v1.0.x.",
        createdOffset: 6 * HOUR,
      },
    ],
  },
  {
    title: "Crash in search results rendering",
    sourceModule: "SearchResultsVC",
    appName: "Demo App",
    status: "new",
    isDev: false,
    firstSeenAt: ago(2 * HOUR),
    lastSeenAt: ago(30 * 60 * 1000),
    occurrences: [
      { userId: "user-99", appVersion: "1.2.0", environment: "ios", timestampOffset: 2 * HOUR },
      { userId: "user-1", appVersion: "1.2.0", environment: "ios", timestampOffset: 1 * HOUR },
      { userId: "user-99", appVersion: "1.2.0", environment: "ipados", timestampOffset: 30 * 60 * 1000 },
    ],
    comments: [],
  },
  {
    title: "Database connection timeout after 30s",
    sourceModule: "db.ts:55",
    appName: "Demo API Server",
    status: "new",
    isDev: false,
    firstSeenAt: ago(3 * DAY),
    lastSeenAt: ago(4 * HOUR),
    occurrences: [
      { userId: null, appVersion: "1.0.0", environment: "backend", timestampOffset: 3 * DAY },
      { userId: null, appVersion: "1.0.0", environment: "backend", timestampOffset: 2 * DAY },
      { userId: null, appVersion: "1.0.1", environment: "backend", timestampOffset: 1 * DAY },
      { userId: null, appVersion: "1.0.1", environment: "backend", timestampOffset: 12 * HOUR },
      { userId: null, appVersion: "1.0.1", environment: "backend", timestampOffset: 4 * HOUR },
    ],
    comments: [],
  },

  // ── in_progress ─────────────────────────────────────────────────────
  {
    title: "Payment processing failed: insufficient funds",
    sourceModule: "PaymentService",
    appName: "Demo App",
    status: "in_progress",
    isDev: false,
    firstSeenAt: ago(14 * DAY),
    lastSeenAt: ago(2 * DAY),
    occurrences: [
      { userId: "user-42", appVersion: "1.0.0", environment: "ios", timestampOffset: 14 * DAY },
      { userId: "user-150", appVersion: "1.0.0", environment: "ios", timestampOffset: 10 * DAY },
      { userId: "user-1", appVersion: "1.0.1", environment: "ios", timestampOffset: 7 * DAY },
      { userId: "owl_anon_abc123", appVersion: "1.1.0", environment: "ios", timestampOffset: 5 * DAY },
      { userId: "user-99", appVersion: "1.1.0", environment: "ipados", timestampOffset: 3 * DAY },
      { userId: "user-42", appVersion: "1.2.0", environment: "ios", timestampOffset: 2 * DAY },
    ],
    comments: [
      {
        authorType: "user",
        body: "Investigating -- appears to be related to Stripe API changes in their latest version.",
        createdOffset: 3 * DAY,
      },
      {
        authorType: "agent",
        body: "Stack trace analysis suggests the error occurs in PaymentService.processCharge() when the Stripe SDK returns an insufficient_funds error code. This may not be a bug -- the user's card was legitimately declined.",
        createdOffset: 2 * DAY,
      },
    ],
  },
  {
    title: "Authentication token expired unexpectedly",
    sourceModule: "auth.ts:118",
    appName: "Demo API Server",
    status: "in_progress",
    isDev: false,
    firstSeenAt: ago(5 * DAY),
    lastSeenAt: ago(12 * HOUR),
    occurrences: [
      { userId: "user-42", appVersion: "1.0.0", environment: "backend", timestampOffset: 5 * DAY },
      { userId: "user-99", appVersion: "1.0.1", environment: "backend", timestampOffset: 3 * DAY },
      { userId: "user-150", appVersion: "1.0.1", environment: "backend", timestampOffset: 1 * DAY },
      { userId: "user-42", appVersion: "1.0.1", environment: "backend", timestampOffset: 12 * HOUR },
    ],
    comments: [],
  },

  // ── resolved ────────────────────────────────────────────────────────
  {
    title: "JSON parsing failed: unexpected token in settings response",
    sourceModule: "SettingsManager",
    appName: "Demo App",
    status: "resolved",
    isDev: false,
    resolvedAtVersion: "1.1.0",
    firstSeenAt: ago(30 * DAY),
    lastSeenAt: ago(21 * DAY),
    occurrences: [
      { userId: "user-42", appVersion: "1.0.0", environment: "ios", timestampOffset: 30 * DAY },
      { userId: "user-99", appVersion: "1.0.0", environment: "ios", timestampOffset: 25 * DAY },
      { userId: "user-1", appVersion: "1.0.0", environment: "ipados", timestampOffset: 21 * DAY },
    ],
    comments: [
      {
        authorType: "user",
        body: "Fixed by switching to the new settings API endpoint in v1.1.0.",
        createdOffset: 20 * DAY,
      },
    ],
  },
  {
    title: "Rate limit exceeded for webhook endpoint",
    sourceModule: "webhook.ts:42",
    appName: "Demo API Server",
    status: "resolved",
    isDev: false,
    resolvedAtVersion: "1.0.1",
    firstSeenAt: ago(20 * DAY),
    lastSeenAt: ago(15 * DAY),
    occurrences: [
      { userId: null, appVersion: "1.0.0", environment: "backend", timestampOffset: 20 * DAY },
      { userId: null, appVersion: "1.0.0", environment: "backend", timestampOffset: 15 * DAY },
    ],
    comments: [],
  },

  // ── regressed ───────────────────────────────────────────────────────
  {
    title: "Network request timeout after 30s",
    sourceModule: "NetworkManager",
    appName: "Demo App",
    status: "regressed",
    isDev: false,
    resolvedAtVersion: "1.1.0",
    firstSeenAt: ago(25 * DAY),
    lastSeenAt: ago(6 * HOUR),
    occurrences: [
      { userId: "user-42", appVersion: "1.0.0", environment: "ios", timestampOffset: 25 * DAY },
      { userId: "user-99", appVersion: "1.0.0", environment: "ios", timestampOffset: 20 * DAY },
      // gap: resolved in 1.1.0
      { userId: "user-42", appVersion: "1.2.0", environment: "ios", timestampOffset: 2 * DAY },
      { userId: "user-1", appVersion: "1.2.0", environment: "ipados", timestampOffset: 12 * HOUR },
      { userId: "user-150", appVersion: "1.2.0", environment: "ios", timestampOffset: 6 * HOUR },
    ],
    comments: [
      {
        authorType: "user",
        body: "This was fixed in v1.1.0 but is back in v1.2.0. Reopening investigation.",
        createdOffset: 2 * DAY,
      },
      {
        authorType: "agent",
        body: "Regression detected: the timeout was originally fixed by increasing the NSURLSession timeout to 60s, but a recent refactor in v1.2.0 reset it to the default 30s.",
        createdOffset: 1 * DAY,
      },
    ],
  },

  // ── silenced ────────────────────────────────────────────────────────
  {
    title: "Deprecated API endpoint used: /v1/legacy/sync",
    sourceModule: "SyncManager",
    appName: "Demo App",
    status: "silenced",
    isDev: false,
    firstSeenAt: ago(60 * DAY),
    lastSeenAt: ago(45 * DAY),
    occurrences: [
      { userId: "user-42", appVersion: "1.0.0", environment: "ios", timestampOffset: 60 * DAY },
      { userId: "user-99", appVersion: "1.0.0", environment: "macos", timestampOffset: 45 * DAY },
    ],
    comments: [],
  },

  // ── new (dev build) ─────────────────────────────────────────────────
  {
    title: "Debug assertion failed: unexpected nil in user defaults",
    sourceModule: "PrefsManager",
    appName: "Demo App",
    status: "new",
    isDev: true,
    firstSeenAt: ago(1 * DAY),
    lastSeenAt: ago(3 * HOUR),
    occurrences: [
      { userId: "user-42", appVersion: "1.2.0", environment: "ios", timestampOffset: 1 * DAY },
      { userId: "user-42", appVersion: "1.2.0", environment: "ios", timestampOffset: 3 * HOUR },
    ],
    comments: [],
  },
];

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const db = createDatabaseConnection(url);

  console.log("Seeding issues...\n");

  // Look up entities created by dev:seed
  const allApps = await db.select().from(apps).where(isNull(apps.deleted_at));
  if (allApps.length === 0) {
    console.error("No apps found. Run `pnpm dev:seed` first.");
    process.exit(1);
  }

  const appByName = new Map(allApps.map((a) => [a.name, a]));
  const demoApp = appByName.get("Demo App");
  const serverApp = appByName.get("Demo API Server");

  if (!demoApp || !serverApp) {
    console.error("Expected 'Demo App' and 'Demo API Server'. Run `pnpm dev:seed` first.");
    process.exit(1);
  }

  const [adminUser] = await db.select().from(users).where(eq(users.email, "admin@owlmetry.com"));
  if (!adminUser) {
    console.error("Admin user not found. Run `pnpm dev:seed` first.");
    process.exit(1);
  }

  // Fake agent ID for agent-authored comments
  const agentId = "00000000-0000-4000-a000-000000000001";

  let created = 0;
  let skipped = 0;

  for (const def of ISSUE_DEFS) {
    const app = def.appName === "Demo App" ? demoApp : serverApp;

    // Generate real fingerprint
    const fingerprint = await generateIssueFingerprint(def.title, def.sourceModule);

    // Idempotency: skip if fingerprint already exists for this app + is_dev
    const [existing] = await db
      .select()
      .from(issueFingerprints)
      .where(
        and(
          eq(issueFingerprints.fingerprint, fingerprint),
          eq(issueFingerprints.app_id, app.id),
          eq(issueFingerprints.is_dev, def.isDev),
        ),
      );

    if (existing) {
      console.log(`  skip  "${def.title}" (already exists)`);
      skipped++;
      continue;
    }

    // Compute denormalized counts from occurrence data
    const uniqueUsers = new Set(def.occurrences.map((o) => o.userId).filter(Boolean));

    // Insert issue
    const [issue] = await db
      .insert(issues)
      .values({
        app_id: app.id,
        project_id: app.project_id,
        status: def.status,
        title: def.title,
        source_module: def.sourceModule,
        is_dev: def.isDev,
        occurrence_count: def.occurrences.length,
        unique_user_count: uniqueUsers.size,
        resolved_at_version: def.resolvedAtVersion ?? null,
        first_seen_at: def.firstSeenAt,
        last_seen_at: def.lastSeenAt,
      })
      .returning({ id: issues.id });

    // Insert fingerprint
    await db.insert(issueFingerprints).values({
      fingerprint,
      app_id: app.id,
      is_dev: def.isDev,
      issue_id: issue.id,
    });

    // Insert occurrences
    await db
      .insert(issueOccurrences)
      .values(
        def.occurrences.map((occ) => ({
          issue_id: issue.id,
          session_id: crypto.randomUUID(),
          user_id: occ.userId,
          app_version: occ.appVersion,
          environment: occ.environment,
          timestamp: ago(occ.timestampOffset),
        })),
      )
      .onConflictDoNothing();

    // Insert comments
    if (def.comments.length > 0) {
      await db.insert(issueComments).values(
        def.comments.map((c) => ({
          issue_id: issue.id,
          author_type: c.authorType,
          author_id: c.authorType === "user" ? adminUser.id : agentId,
          author_name: c.authorType === "user" ? adminUser.name ?? "Admin" : "Owlmetry Agent",
          body: c.body,
          created_at: ago(c.createdOffset),
        })),
      );
    }

    const statusPad = def.status.padEnd(11);
    console.log(`  ${statusPad} "${def.title}" (${def.occurrences.length} occurrences, ${def.comments.length} comments)`);
    created++;
  }

  console.log(`\nSeed complete: ${created} issues created, ${skipped} skipped (already exist).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
