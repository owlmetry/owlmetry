/**
 * CLI Binary Integration Tests
 *
 * Tests the compiled CLI binary (dist/index.cjs) by invoking it via execFileSync.
 * Catches Commander.js option parsing bugs that client-level tests miss.
 *
 * Skipped commands (modify global config):
 *   - auth send-code, auth verify, setup, switch
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const TEST_ENDPOINT = process.env.OWLMETRY_TEST_ENDPOINT;
const TEST_AGENT_KEY = process.env.OWLMETRY_TEST_AGENT_KEY;
const TEST_TEAM_ID = process.env.OWLMETRY_TEST_TEAM_ID;

const CLI_BIN = resolve(process.cwd(), "dist/index.cjs");
const UNIQUE = Date.now().toString(36);

// --- Helpers ---

function cli(...args: string[]): any {
  const stdout = execFileSync("node", [
    CLI_BIN, ...args,
    "--endpoint", TEST_ENDPOINT!,
    "--api-key", TEST_AGENT_KEY!,
    "--format", "json",
  ], { encoding: "utf-8", timeout: 15000, env: process.env });
  return JSON.parse(stdout);
}

function cliRaw(...args: string[]): string {
  return execFileSync("node", [
    CLI_BIN, ...args,
    "--endpoint", TEST_ENDPOINT!,
    "--api-key", TEST_AGENT_KEY!,
  ], { encoding: "utf-8", timeout: 15000, env: process.env });
}

function cliExpectFail(...args: string[]): { stderr: string; status: number | null } {
  try {
    execFileSync("node", [
      CLI_BIN, ...args,
      "--endpoint", TEST_ENDPOINT!,
      "--api-key", TEST_AGENT_KEY!,
      "--format", "json",
    ], { encoding: "utf-8", timeout: 15000, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    return { stderr: "", status: 0 };
  } catch (err: any) {
    return { stderr: err.stderr || "", status: err.status };
  }
}

describe.skipIf(!TEST_ENDPOINT)("integration: CLI binary", () => {
  let seededProjectId: string;
  let seededAppId: string;
  let createdProjectId: string;
  let createdAppId: string;
  let metricSlug: string;
  let funnelSlug: string;
  let eventId: string;

  // --- Group 1: Identity / Info ---

  describe("whoami", () => {
    it("returns api_key identity", () => {
      const result = cli("whoami");
      expect(result.type).toBe("api_key");
      expect(result.key_type).toBe("agent");
      expect(result.permissions).toBeInstanceOf(Array);
      expect(result.permissions.length).toBeGreaterThan(0);
    });
  });

  describe("skills", () => {
    it("lists skill file paths", () => {
      const output = execFileSync("node", [CLI_BIN, "skills"], {
        encoding: "utf-8",
        timeout: 15000,
        env: process.env,
      });
      expect(output).toContain("owlmetry-cli");
      expect(output).toContain("owlmetry-node");
      expect(output).toContain("owlmetry-swift");
    });
  });

  // --- Group 2: Projects CRUD ---

  describe("projects", () => {
    it("lists seeded projects", () => {
      const result = cli("projects");
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("name");
      seededProjectId = result[0].id;
    });

    it("creates a project", () => {
      const slug = `cli-bin-${UNIQUE}`;
      const result = cli("projects", "create", "--name", "CLI Binary Test", "--slug", slug, "--team-id", TEST_TEAM_ID!);
      expect(result.name).toBe("CLI Binary Test");
      expect(result.slug).toBe(slug);
      expect(result.id).toBeDefined();
      createdProjectId = result.id;
    });

    it("views the created project", () => {
      const result = cli("projects", "view", createdProjectId);
      expect(result.id).toBe(createdProjectId);
      expect(result.name).toBe("CLI Binary Test");
    });

    it("updates the project name", () => {
      const result = cli("projects", "update", createdProjectId, "--name", "CLI Binary Updated");
      expect(result.name).toBe("CLI Binary Updated");
    });
  });

  // --- Group 3: Apps CRUD ---

  describe("apps", () => {
    it("lists apps", () => {
      const result = cli("apps", "list");
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty("platform");
      seededAppId = result[0].id;
    });

    it("lists apps filtered by --project-id", () => {
      const result = cli("apps", "list", "--project-id", seededProjectId);
      expect(Array.isArray(result)).toBe(true);
      for (const app of result) {
        expect(app.project_id).toBe(seededProjectId);
      }
    });

    it("creates a backend app", () => {
      const result = cli("apps", "create", "--project-id", createdProjectId, "--name", "CLI Binary App", "--platform", "backend");
      expect(result.name).toBe("CLI Binary App");
      expect(result.platform).toBe("backend");
      expect(result.client_key).toBeDefined();
      createdAppId = result.id;
    });

    it("views the created app", () => {
      const result = cli("apps", "view", createdAppId);
      expect(result.id).toBe(createdAppId);
      expect(result.name).toBe("CLI Binary App");
    });

    it("updates the app name", () => {
      const result = cli("apps", "update", createdAppId, "--name", "CLI Binary App Updated");
      expect(result.name).toBe("CLI Binary App Updated");
    });
  });

  // --- Group 4: Metrics CRUD ---

  describe("metrics", () => {
    it("creates a metric with --project-id", () => {
      metricSlug = `cli-bin-metric-${UNIQUE}`;
      const result = cli("metrics", "create", "--project-id", createdProjectId, "--name", "CLI Test Metric", "--slug", metricSlug, "--lifecycle");
      expect(result.slug).toBe(metricSlug);
      expect(result.name).toBe("CLI Test Metric");
    });

    it("lists metrics with --project-id", () => {
      const result = cli("metrics", "list", "--project-id", createdProjectId);
      expect(Array.isArray(result)).toBe(true);
      expect(result.some((m: any) => m.slug === metricSlug)).toBe(true);
    });

    it("views metric by slug with --project-id", () => {
      const result = cli("metrics", "view", metricSlug, "--project-id", createdProjectId);
      expect(result.slug).toBe(metricSlug);
      expect(result.name).toBe("CLI Test Metric");
    });

    it("updates metric with --project-id", () => {
      const result = cli("metrics", "update", metricSlug, "--project-id", createdProjectId, "--name", "Updated Metric");
      expect(result.name).toBe("Updated Metric");
    });

    it("queries metric aggregation with --project-id", () => {
      const result = cli("metrics", "query", metricSlug, "--project-id", createdProjectId);
      expect(result).toHaveProperty("slug");
      expect(result).toHaveProperty("aggregation");
    });

    it("queries metric events with --project-id", () => {
      const result = cli("metrics", "events", metricSlug, "--project-id", createdProjectId);
      expect(result).toHaveProperty("events");
      expect(Array.isArray(result.events)).toBe(true);
    });

    it("deletes a metric with --project-id", () => {
      const output = cliRaw("metrics", "delete", metricSlug, "--project-id", createdProjectId);
      expect(output).toContain("deleted");
    });
  });

  // --- Group 5: Funnels CRUD ---

  describe("funnels", () => {
    it("creates a funnel with --project-id and --steps", () => {
      funnelSlug = `cli-bin-funnel-${UNIQUE}`;
      const steps = JSON.stringify([
        { name: "step-one", event_filter: { step_name: "step-one" } },
        { name: "step-two", event_filter: { step_name: "step-two" } },
      ]);
      const result = cli("funnels", "create", "--project-id", createdProjectId, "--name", "CLI Test Funnel", "--slug", funnelSlug, "--steps", steps);
      expect(result.slug).toBe(funnelSlug);
      expect(result.name).toBe("CLI Test Funnel");
      expect(result.steps).toHaveLength(2);
    });

    it("lists funnels with --project-id", () => {
      const result = cli("funnels", "list", "--project-id", createdProjectId);
      expect(Array.isArray(result)).toBe(true);
      expect(result.some((f: any) => f.slug === funnelSlug)).toBe(true);
    });

    it("views funnel by slug with --project-id", () => {
      const result = cli("funnels", "view", funnelSlug, "--project-id", createdProjectId);
      expect(result.slug).toBe(funnelSlug);
      expect(result.steps).toHaveLength(2);
    });

    it("updates funnel with --project-id", () => {
      const result = cli("funnels", "update", funnelSlug, "--project-id", createdProjectId, "--name", "Updated Funnel");
      expect(result.name).toBe("Updated Funnel");
    });

    it("queries funnel analytics with --project-id", () => {
      const result = cli("funnels", "query", funnelSlug, "--project-id", createdProjectId);
      expect(result).toHaveProperty("slug");
      expect(result).toHaveProperty("analytics");
    });

    it("deletes a funnel with --project-id", () => {
      const output = cliRaw("funnels", "delete", funnelSlug, "--project-id", createdProjectId);
      expect(output).toContain("deleted");
    });
  });

  // --- Group 6: Events ---

  describe("events", () => {
    it("queries events", () => {
      const result = cli("events", "--data-mode", "all");
      expect(result).toHaveProperty("events");
      expect(result).toHaveProperty("has_more");
      expect(Array.isArray(result.events)).toBe(true);
      if (result.events.length > 0) {
        eventId = result.events[0].id;
      }
    });

    it("filters events by --project-id", () => {
      const result = cli("events", "--project-id", seededProjectId, "--data-mode", "all");
      expect(Array.isArray(result.events)).toBe(true);
    });

    it("filters events by --app-id", () => {
      const result = cli("events", "--app-id", seededAppId, "--data-mode", "all");
      expect(Array.isArray(result.events)).toBe(true);
    });

    it("filters events by --level", () => {
      const result = cli("events", "--level", "error", "--data-mode", "all");
      for (const event of result.events) {
        expect(event.level).toBe("error");
      }
    });

    it("limits events with --limit", () => {
      const result = cli("events", "--limit", "1", "--data-mode", "all");
      expect(result.events.length).toBeLessThanOrEqual(1);
    });

    it("views a single event", () => {
      if (!eventId) return; // skip if no events were ingested
      const result = cli("events", "view", eventId);
      expect(result.id).toBe(eventId);
      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("session_id");
    });
  });

  // --- Group 7: Investigate ---

  describe("investigate", () => {
    it("shows surrounding events", () => {
      if (!eventId) return;
      const result = cli("investigate", eventId, "--window", "10");
      expect(result).toHaveProperty("target");
      expect(result).toHaveProperty("context");
      expect(result.target.id).toBe(eventId);
    });
  });

  // --- Group 8: Users ---

  describe("users", () => {
    it("lists users for an app", () => {
      const result = cli("users", seededAppId);
      expect(result).toHaveProperty("users");
      expect(result).toHaveProperty("has_more");
      expect(Array.isArray(result.users)).toBe(true);
    });
  });

  // --- Group 9: Audit Logs ---

  describe("audit-log", () => {
    it("lists audit logs with --team-id", () => {
      const result = cli("audit-log", "list", "--team-id", TEST_TEAM_ID!);
      expect(result).toHaveProperty("audit_logs");
      expect(result).toHaveProperty("has_more");
      expect(Array.isArray(result.audit_logs)).toBe(true);
    });
  });

  // --- Group 10: Option Routing Regressions ---

  describe("option routing regressions", () => {
    it("metrics list fails without --project-id", () => {
      const { status, stderr } = cliExpectFail("metrics", "list");
      expect(status).not.toBe(0);
      expect(stderr).toContain("--project-id");
    });

    it("funnels list fails without --project-id", () => {
      const { status, stderr } = cliExpectFail("funnels", "list");
      expect(status).not.toBe(0);
      expect(stderr).toContain("--project-id");
    });

    it("audit-log list fails without --team-id", () => {
      const { status, stderr } = cliExpectFail("audit-log", "list");
      expect(status).not.toBe(0);
      expect(stderr).toContain("--team-id");
    });

    it("metrics view fails without --project-id", () => {
      const { status, stderr } = cliExpectFail("metrics", "view", "some-slug");
      expect(status).not.toBe(0);
      expect(stderr).toContain("--project-id");
    });

    it("funnels view fails without --project-id", () => {
      const { status, stderr } = cliExpectFail("funnels", "view", "some-slug");
      expect(status).not.toBe(0);
      expect(stderr).toContain("--project-id");
    });
  });
});
