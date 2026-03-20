import { createDatabaseConnection } from "./index.js";
import { apps, events, appUsers, metricEvents, funnelEvents } from "./schema.js";
import { eq, isNull, and } from "drizzle-orm";
import { parseMetricMessage } from "@owlmetry/shared";
import crypto from "node:crypto";
import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  console.error("Seed script is for development only. Aborting.");
  process.exit(1);
}

const url = process.env.DATABASE_URL || "postgres://localhost:5432/owlmetry";

// ── Configuration ──────────────────────────────────────────────────────

// Filter out bare "--" args injected by pnpm passthrough
const args = process.argv.slice(2).filter((a) => a !== "--");
const EVENT_COUNT = parseInt(args[0] || "200", 10);
const TIME_SPAN_HOURS = parseInt(args[1] || "24", 10);

// ── Realistic data pools ───────────────────────────────────────────────

const SCREENS = [
  "HomeScreen",
  "LoginScreen",
  "DashboardScreen",
  "ProfileScreen",
  "SettingsScreen",
  "SearchScreen",
  "OnboardingScreen",
  "DetailScreen",
  "CheckoutScreen",
  "NotificationsScreen",
];

const MODULES = [
  "AppDelegate",
  "NetworkManager",
  "AuthService",
  "ImageLoader",
  "CacheManager",
  "AnalyticsTracker",
  "PushHandler",
  "DatabaseManager",
  "PaymentService",
  "SearchEngine",
];

type EventTemplate = {
  level: "info" | "debug" | "warn" | "error";
  weight: number;
  messages: string[];
  customAttributes?: () => Record<string, string>;
};

const TEMPLATES: EventTemplate[] = [
  {
    level: "info",
    weight: 35,
    messages: [
      "App launched",
      "Screen appeared",
      "User signed in",
      "Data loaded successfully",
      "Push notification received",
      "Background fetch completed",
      "Cache hit for resource",
      "Navigation to new screen",
      "User session started",
      "Configuration loaded",
    ],
  },
  {
    level: "debug",
    weight: 20,
    messages: [
      "Prefetching next page",
      "Loading user preferences",
      "WebSocket connection established",
      "Image decoded in 45ms",
      "Database query returned 42 rows",
      "Token refresh in progress",
      "Gesture recognizer activated",
      "Layout pass completed",
      "Memory cache size: 24MB",
      "Background task registered",
    ],
  },
  {
    level: "warn",
    weight: 15,
    messages: [
      "Slow network response: 2.3s",
      "Retry attempt 2/3 for API call",
      "Memory pressure warning",
      "Deprecated API endpoint used",
      "Large image decoded on main thread",
      "Certificate will expire in 7 days",
      "Disk cache approaching limit (90%)",
      "Rate limit approaching: 85/100",
      "Fallback to cached data",
      "Location permission not granted",
    ],
  },
  {
    level: "error",
    weight: 10,
    messages: [
      "Failed to load profile image: 404",
      "Network request timeout after 30s",
      "JSON parsing failed: unexpected token",
      "Database write conflict",
      "Authentication token expired",
      "Crash in list rendering",
      "Payment processing failed: insufficient funds",
      "Push notification registration failed",
      "File download interrupted",
      "API returned 500: internal server error",
    ],
  },
  {
    level: "warn",
    weight: 8,
    messages: [
      "User skipped onboarding step 3",
      "Unusual login location detected",
      "Cart abandoned after 5 minutes",
      "User downgraded subscription",
      "Multiple failed login attempts",
      "App inactive for 30+ days",
      "Feature flag override active",
      "User cleared all data",
    ],
  },
  {
    level: "info",
    weight: 12,
    messages: [
      "metric:onboarding:record",
      "metric:photo-conversion:start",
      "metric:photo-conversion:complete",
      "metric:photo-conversion:fail",
      "metric:checkout:start",
      "metric:checkout:complete",
      "metric:checkout:fail",
      "metric:search:record",
      "metric:share:record",
      "metric:feature-usage:record",
    ],
    customAttributes: () => ({
      tracking_id: crypto.randomUUID(),
      duration_ms: String(Math.floor(Math.random() * 5000)),
    }),
  },
];

// ── Funnel track events ──────────────────────────────────────────────

// Onboarding funnel steps in order — users progress through these with drop-off
const ONBOARDING_STEPS = [
  "track:welcome-screen",
  "track:create-account",
  "track:complete-profile",
  "track:first-post",
];

const EXPERIMENT_VARIANTS: Record<string, string[]> = {
  onboarding: ["A", "B"],
};

type DeviceProfile = {
  environment: "ios" | "ipados" | "macos" | "android" | "web" | "backend";
  os_version: string;
  device_model: string;
  locale: string;
};

const DEVICE_PROFILES: DeviceProfile[] = [
  { environment: "ios", os_version: "18.3", device_model: "iPhone 16", locale: "en_US" },
  { environment: "ios", os_version: "18.3", device_model: "iPhone 16 Pro", locale: "en_US" },
  { environment: "ios", os_version: "18.2", device_model: "iPhone 15 Pro", locale: "en_GB" },
  { environment: "ios", os_version: "18.1", device_model: "iPhone 15", locale: "de_DE" },
  { environment: "ios", os_version: "17.7", device_model: "iPhone 14", locale: "ja_JP" },
  { environment: "ipados", os_version: "18.3", device_model: "iPad Pro 13-inch", locale: "en_US" },
  { environment: "ipados", os_version: "18.2", device_model: "iPad Air", locale: "fr_FR" },
  { environment: "android", os_version: "15", device_model: "Pixel 9 Pro", locale: "en_US" },
  { environment: "android", os_version: "14", device_model: "Samsung Galaxy S24", locale: "ko_KR" },
  { environment: "android", os_version: "14", device_model: "OnePlus 12", locale: "en_IN" },
  { environment: "web", os_version: "Chrome 132", device_model: "Desktop", locale: "en_US" },
  { environment: "web", os_version: "Safari 18.3", device_model: "Desktop", locale: "en_US" },
];

const APP_VERSIONS = ["1.0.0", "1.0.1", "1.1.0", "1.2.0"];
const BUILD_NUMBERS = ["1", "2", "12", "15", "23", "42"];
const USER_IDS = [
  "user-1", "user-2", "user-3", "user-7", "user-12",
  "user-42", "user-88", "user-99", "user-150", "user-201",
  "owl_anon_abc123", "owl_anon_def456", "owl_anon_ghi789",
  null, null, // some events have no user
];

// ── Helpers ────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick(templates: EventTemplate[]): EventTemplate {
  const totalWeight = templates.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.random() * totalWeight;
  for (const t of templates) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return templates[templates.length - 1];
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const db = createDatabaseConnection(url);

  // Find all non-deleted apps
  const allApps = await db
    .select({ id: apps.id, platform: apps.platform, name: apps.name })
    .from(apps)
    .where(isNull(apps.deleted_at));

  if (allApps.length === 0) {
    console.error("No apps found. Run pnpm dev:seed first.");
    process.exit(1);
  }

  console.log(`Generating ${EVENT_COUNT} events across ${TIME_SPAN_HOURS}h for ${allApps.length} app(s)...\n`);

  const now = Date.now();
  const spanMs = TIME_SPAN_HOURS * 60 * 60 * 1000;

  // Generate sessions: each session is a user on a device with a burst of events
  const SESSION_COUNT = Math.max(5, Math.ceil(EVENT_COUNT / 12));
  const sessions: Array<{
    id: string;
    appId: string;
    userId: string | null;
    device: DeviceProfile;
    appVersion: string;
    buildNumber: string;
    startTime: number;
  }> = [];

  for (let i = 0; i < SESSION_COUNT; i++) {
    const app = pick(allApps);
    const device = app.platform === "backend"
      ? { environment: "backend" as const, os_version: "Node.js 22.0.0", device_model: "Server", locale: "en_US" }
      : pick(DEVICE_PROFILES);

    sessions.push({
      id: crypto.randomUUID(),
      appId: app.id,
      userId: pick(USER_IDS),
      device,
      appVersion: pick(APP_VERSIONS),
      buildNumber: pick(BUILD_NUMBERS),
      startTime: now - Math.floor(Math.random() * spanMs),
    });
  }

  // Generate events
  const rows: Array<typeof events.$inferInsert> = [];

  for (let i = 0; i < EVENT_COUNT; i++) {
    const session = pick(sessions);
    const template = weightedPick(TEMPLATES);
    const offsetMs = Math.floor(Math.random() * 300_000); // up to 5 min within session

    rows.push({
      app_id: session.appId,
      session_id: session.id,
      user_id: session.userId,
      level: template.level,
      message: pick(template.messages),
      screen_name: session.device.environment === "backend" ? null : pick(SCREENS),
      source_module: pick(MODULES),
      environment: session.device.environment,
      os_version: session.device.os_version,
      app_version: session.appVersion,
      build_number: session.buildNumber,
      device_model: session.device.device_model,
      locale: session.device.locale,
      timestamp: new Date(session.startTime + offsetMs),
      custom_attributes: template.customAttributes ? template.customAttributes() : null,
    });
  }

  // Insert in batches of 500
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(events).values(batch);
    inserted += batch.length;
  }

  // Dual-write metric events into metric_events table
  const metricRows: Array<typeof metricEvents.$inferInsert> = [];
  for (const row of rows) {
    const parsed = parseMetricMessage(row.message);
    if (!parsed) continue;
    const attrs = (row.custom_attributes ?? {}) as Record<string, string>;
    metricRows.push({
      app_id: row.app_id,
      session_id: row.session_id!,
      user_id: row.user_id ?? null,
      metric_slug: parsed.slug,
      phase: parsed.phase,
      tracking_id: attrs.tracking_id ?? null,
      duration_ms: attrs.duration_ms ? parseInt(attrs.duration_ms, 10) || null : null,
      error: parsed.phase === "fail" ? "Something went wrong" : null,
      attributes: row.custom_attributes as Record<string, string> | null,
      environment: row.environment ?? null,
      os_version: row.os_version ?? null,
      app_version: row.app_version ?? null,
      device_model: row.device_model ?? null,
      build_number: row.build_number ?? null,
      is_dev: row.is_dev ?? false,
      timestamp: row.timestamp as Date,
    });
  }

  if (metricRows.length > 0) {
    for (let i = 0; i < metricRows.length; i += BATCH_SIZE) {
      await db.insert(metricEvents).values(metricRows.slice(i, i + BATCH_SIZE));
    }
    console.log(`Dual-wrote ${metricRows.length} metric events`);
  }

  // ── Generate funnel track events ────────────────────────────────────
  // Simulate realistic onboarding funnel: ~60 users start, with drop-off at each step
  const funnelUserCount = Math.max(20, Math.ceil(EVENT_COUNT / 4));
  const funnelTrackRows: Array<typeof events.$inferInsert> = [];
  const funnelDualRows: Array<typeof funnelEvents.$inferInsert> = [];

  // Use only non-backend apps for funnel events
  const clientApps = allApps.filter((a) => a.platform !== "backend");
  if (clientApps.length > 0) {
    // Drop-off probabilities: 100% → 70% → 50% → 30%
    const STEP_RETENTION = [1.0, 0.7, 0.5, 0.3];

    for (let u = 0; u < funnelUserCount; u++) {
      const userId = `user-${u + 1}`;
      const session = {
        id: crypto.randomUUID(),
        appId: pick(clientApps).id,
        device: pick(DEVICE_PROFILES.filter((d) => d.environment !== "backend")),
        appVersion: pick(APP_VERSIONS),
        buildNumber: pick(BUILD_NUMBERS),
      };
      // Assign experiment variant
      const experiments: Record<string, string> = {};
      for (const [name, variants] of Object.entries(EXPERIMENT_VARIANTS)) {
        experiments[name] = pick(variants);
      }

      const baseTime = now - Math.floor(Math.random() * spanMs);

      for (let s = 0; s < ONBOARDING_STEPS.length; s++) {
        // Check if user reaches this step
        if (Math.random() > STEP_RETENTION[s]) break;

        const stepMessage = ONBOARDING_STEPS[s];
        const stepName = stepMessage.slice("track:".length);
        const ts = new Date(baseTime + s * 30_000); // 30s between steps

        const eventRow: typeof events.$inferInsert = {
          app_id: session.appId,
          session_id: session.id,
          user_id: userId,
          level: "info",
          message: stepMessage,
          screen_name: "OnboardingScreen",
          source_module: "OwlMetry",
          environment: session.device.environment,
          os_version: session.device.os_version,
          app_version: session.appVersion,
          build_number: session.buildNumber,
          device_model: session.device.device_model,
          locale: session.device.locale,
          experiments,
          timestamp: ts,
        };
        funnelTrackRows.push(eventRow);

        funnelDualRows.push({
          app_id: session.appId,
          session_id: session.id,
          user_id: userId,
          step_name: stepName,
          message: stepMessage,
          screen_name: "OnboardingScreen",
          experiments,
          environment: session.device.environment,
          os_version: session.device.os_version,
          app_version: session.appVersion,
          build_number: session.buildNumber,
          device_model: session.device.device_model,
          is_dev: false,
          timestamp: ts,
        });
      }
    }

    // Insert track events into events table
    for (let i = 0; i < funnelTrackRows.length; i += BATCH_SIZE) {
      await db.insert(events).values(funnelTrackRows.slice(i, i + BATCH_SIZE));
    }
    inserted += funnelTrackRows.length;

    // Dual-write into funnel_events table
    for (let i = 0; i < funnelDualRows.length; i += BATCH_SIZE) {
      await db.insert(funnelEvents).values(funnelDualRows.slice(i, i + BATCH_SIZE));
    }
    console.log(`Generated ${funnelTrackRows.length} track events for ${funnelUserCount} funnel users`);
    console.log(`Dual-wrote ${funnelDualRows.length} funnel events\n`);
  }

  // Upsert app_users for any user_ids we generated
  const userAppPairs = new Map<string, { appId: string; isAnon: boolean; earliest: Date; latest: Date }>();
  for (const row of [...rows, ...funnelTrackRows]) {
    if (!row.user_id) continue;
    const key = `${row.app_id}:${row.user_id}`;
    const ts = row.timestamp as Date;
    const existing = userAppPairs.get(key);
    if (existing) {
      if (ts < existing.earliest) existing.earliest = ts;
      if (ts > existing.latest) existing.latest = ts;
    } else {
      userAppPairs.set(key, {
        appId: row.app_id,
        isAnon: row.user_id.startsWith("owl_anon_"),
        earliest: ts,
        latest: ts,
      });
    }
  }

  for (const [key, val] of userAppPairs) {
    const userId = key.split(":").slice(1).join(":");
    await db
      .insert(appUsers)
      .values({
        app_id: val.appId,
        user_id: userId,
        is_anonymous: val.isAnon,
        first_seen_at: val.earliest,
        last_seen_at: val.latest,
      })
      .onConflictDoNothing();
  }

  // Print summary
  const levelCounts: Record<string, number> = {};
  for (const r of rows) {
    levelCounts[r.level] = (levelCounts[r.level] || 0) + 1;
  }

  console.log(`Inserted ${inserted} events across ${sessions.length} sessions\n`);
  console.log("By level:");
  for (const [level, count] of Object.entries(levelCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${level.padEnd(10)} ${count}`);
  }
  console.log(`\nApps:`);
  for (const app of allApps) {
    const count = rows.filter((r) => r.app_id === app.id).length;
    console.log(`  ${app.name.padEnd(20)} ${count} events`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed events failed:", err);
  process.exit(1);
});
