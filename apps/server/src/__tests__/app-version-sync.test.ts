import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";
import { TEST_DB_URL } from "./setup.js";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { apps, teams, projects } from "@owlmetry/db";

const dbClient = postgres(TEST_DB_URL, { max: 1 });
const db = drizzle(dbClient);

let teamId: string;
let projectId: string;
let appleAppId: string;
let backendAppId: string;
let androidAppId: string;

async function createApp(opts: { platform: string; bundle_id: string | null; name: string }): Promise<string> {
  const [row] = await db
    .insert(apps)
    .values({
      team_id: teamId,
      project_id: projectId,
      name: opts.name,
      platform: opts.platform as "apple" | "android" | "web" | "backend",
      bundle_id: opts.bundle_id,
    })
    .returning({ id: apps.id });
  return row.id;
}

beforeAll(async () => {
  const [team] = await db
    .insert(teams)
    .values({ name: "App Version Sync Test Team", slug: `avs-${Date.now()}` })
    .returning({ id: teams.id });
  teamId = team.id;
  const [project] = await db
    .insert(projects)
    .values({ team_id: teamId, name: "App Version Sync Test", slug: `avs-${Date.now()}`, color: "#ff0000" })
    .returning({ id: projects.id });
  projectId = project.id;
});

beforeEach(async () => {
  // Reset apps before each test so iTunes-vs-computed assertions don't leak
  appleAppId = await createApp({ platform: "apple", bundle_id: "com.example.test", name: "Apple App" });
  backendAppId = await createApp({ platform: "backend", bundle_id: null, name: "Backend App" });
  androidAppId = await createApp({ platform: "android", bundle_id: "com.example.android", name: "Android App" });
});

afterAll(async () => {
  await db.delete(apps).where(eq(apps.team_id, teamId));
  await db.delete(projects).where(eq(projects.team_id, teamId));
  await db.delete(teams).where(eq(teams.id, teamId));
  await dbClient.end();
});

function jobCtx() {
  return {
    runId: "test-run",
    updateProgress: async () => {},
    isCancelled: () => false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    db,
    createClient: () => postgres(TEST_DB_URL, { max: 1 }),
    emailService: undefined,
  };
}

describe("app_version_sync", () => {
  it("hits iTunes Lookup for Apple apps and stores version with source='app_store'", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toContain("itunes.apple.com");
      expect(String(url)).toContain("com.example.test");
      return new Response(
        JSON.stringify({ resultCount: 1, results: [{ version: "5.4.2", bundleId: "com.example.test" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { appVersionSyncHandler } = await import("../jobs/app-version-sync.js");
    const result = await appVersionSyncHandler(jobCtx(), { app_id: appleAppId });

    expect(result.app_store_synced).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [row] = await db.select().from(apps).where(eq(apps.id, appleAppId));
    expect(row.latest_app_version).toBe("5.4.2");
    expect(row.latest_app_version_source).toBe("app_store");
    expect(row.latest_app_version_updated_at).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it("falls back to computed when iTunes returns 404", async () => {
    const fetchMock = vi.fn(async () => new Response("Not Found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    // No production events in DB → computed should produce null
    const { appVersionSyncHandler } = await import("../jobs/app-version-sync.js");
    const result = await appVersionSyncHandler(jobCtx(), { app_id: appleAppId });

    expect(result.app_store_synced).toBe(0);
    const [row] = await db.select().from(apps).where(eq(apps.id, appleAppId));
    expect(row.latest_app_version).toBeNull();

    vi.unstubAllGlobals();
  });

  it("counts an error and falls back to computed when iTunes throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    vi.stubGlobal("fetch", fetchMock);

    // Seed a production event so the computed fallback has something to find
    const sessionId = "00000000-0000-0000-0000-cccccccc0001";
    const now = new Date();
    await dbClient`
      INSERT INTO events (app_id, session_id, level, message, app_version, is_dev, "timestamp")
      VALUES (${appleAppId}, ${sessionId}, 'info', 'test', '7.0.0', false, ${now.toISOString()}::timestamptz)
    `;

    const { appVersionSyncHandler } = await import("../jobs/app-version-sync.js");
    const result = await appVersionSyncHandler(jobCtx(), { app_id: appleAppId });

    expect(result.errors).toBe(1);
    expect(result.app_store_synced).toBe(0);
    expect(result.computed_synced).toBe(1);

    const [row] = await db.select().from(apps).where(eq(apps.id, appleAppId));
    expect(row.latest_app_version).toBe("7.0.0");
    expect(row.latest_app_version_source).toBe("computed");

    vi.unstubAllGlobals();
  });

  it("computes from production events for non-Apple apps using semver-aware max", async () => {
    // Insert a backend event with multiple versions, including the lexicographic-trap pair 1.10.0 vs 1.9.0
    const sessionId = "00000000-0000-0000-0000-bbbbbbbbb001";
    const now = new Date();
    for (const version of ["1.0.0", "1.9.0", "1.10.0", "1.5.0"]) {
      await dbClient`
        INSERT INTO events (app_id, session_id, level, message, app_version, is_dev, "timestamp")
        VALUES (${backendAppId}, ${sessionId}, 'info', 'test', ${version}, false, ${now.toISOString()}::timestamptz)
      `;
    }
    // Insert a dev event with a higher version that should be ignored
    await dbClient`
      INSERT INTO events (app_id, session_id, level, message, app_version, is_dev, "timestamp")
      VALUES (${backendAppId}, ${sessionId}, 'info', 'test', '99.0.0', true, ${now.toISOString()}::timestamptz)
    `;

    const { appVersionSyncHandler } = await import("../jobs/app-version-sync.js");
    const result = await appVersionSyncHandler(jobCtx(), { app_id: backendAppId });

    expect(result.computed_synced).toBe(1);
    const [row] = await db.select().from(apps).where(eq(apps.id, backendAppId));
    expect(row.latest_app_version).toBe("1.10.0"); // semver-aware: 1.10 > 1.9
    expect(row.latest_app_version_source).toBe("computed");
  });

  it("only syncs the requested app when app_id is passed", async () => {
    const { appVersionSyncHandler } = await import("../jobs/app-version-sync.js");
    const result = await appVersionSyncHandler(jobCtx(), { app_id: androidAppId });
    expect(result.apps_processed).toBe(1);
  });
});
