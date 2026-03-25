import { OwlMetryClient, ApiError } from "../../client.js";

const TEST_ENDPOINT = process.env.OWLMETRY_TEST_ENDPOINT;
const TEST_AGENT_KEY = process.env.OWLMETRY_TEST_AGENT_KEY;

function makeClient(): OwlMetryClient {
  return new OwlMetryClient({
    endpoint: TEST_ENDPOINT!,
    apiKey: TEST_AGENT_KEY!,
  });
}

describe.skipIf(!TEST_ENDPOINT)("integration: OwlMetryClient", () => {
  let client: OwlMetryClient;

  beforeAll(() => {
    client = makeClient();
  });

  // --- Projects ---

  describe("projects", () => {
    it("lists seeded projects", async () => {
      const projects = await client.listProjects();
      expect(projects.length).toBeGreaterThan(0);
      expect(projects[0]).toHaveProperty("id");
      expect(projects[0]).toHaveProperty("name");
      expect(projects[0]).toHaveProperty("slug");
    });

    it("creates and retrieves a project", async () => {
      const slug = `cli-test-${Date.now()}`;
      const created = await client.createProject({ name: "CLI Test Project", slug, team_id: process.env.OWLMETRY_TEST_TEAM_ID! });
      expect(created.name).toBe("CLI Test Project");
      expect(created.id).toBeDefined();

      const detail = await client.getProject(created.id);
      expect(detail.name).toBe("CLI Test Project");
      expect(detail.apps).toEqual([]);
    });

    it("updates a project name", async () => {
      const created = await client.createProject({ name: "To Rename", slug: `cli-rename-${Date.now()}`, team_id: process.env.OWLMETRY_TEST_TEAM_ID! });
      const updated = await client.updateProject(created.id, { name: "Renamed" });
      expect(updated.name).toBe("Renamed");
    });
  });

  // --- Apps ---

  describe("apps", () => {
    it("lists seeded apps", async () => {
      const apps = await client.listApps();
      expect(apps.length).toBeGreaterThan(0);
      expect(apps[0]).toHaveProperty("platform");
    });

    it("creates and retrieves an app", async () => {
      const projects = await client.listProjects();
      const projectId = projects[0].id;

      const created = await client.createApp({
        name: "CLI Test App",
        platform: "backend",
        project_id: projectId,
      });
      expect(created.name).toBe("CLI Test App");
      expect(created.platform).toBe("backend");

      const fetched = await client.getApp(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe("CLI Test App");
    });
  });

  // --- Events ---

  describe("events", () => {
    it("queries events with limit", async () => {
      const result = await client.queryEvents({ limit: 5 });
      expect(result).toHaveProperty("events");
      expect(result).toHaveProperty("has_more");
      expect(result).toHaveProperty("cursor");
      expect(Array.isArray(result.events)).toBe(true);
    });

    it("queries events with level filter", async () => {
      const result = await client.queryEvents({ level: "error", limit: 5 });
      for (const event of result.events) {
        expect(event.level).toBe("error");
      }
    });

    it("retrieves a single event", async () => {
      const list = await client.queryEvents({ limit: 1 });
      if (list.events.length > 0) {
        const event = await client.getEvent(list.events[0].id);
        expect(event.id).toBe(list.events[0].id);
        expect(event).toHaveProperty("message");
        expect(event).toHaveProperty("session_id");
      }
    });
  });

  // --- Metrics ---

  describe("metrics", () => {
    it("creates, lists, and retrieves a metric", async () => {
      const projects = await client.listProjects();
      const projectId = projects[0].id;
      const slug = `cli-test-${Date.now()}`;

      const created = await client.createMetric(projectId, { name: "CLI Test Metric", slug });
      expect(created.slug).toBe(slug);

      const list = await client.listMetrics(projectId);
      expect(list.some((m) => m.slug === slug)).toBe(true);

      const fetched = await client.getMetric(slug, projectId);
      expect(fetched.slug).toBe(slug);
      expect(fetched.name).toBe("CLI Test Metric");
    });
  });

  // --- Funnels ---

  describe("funnels", () => {
    it("creates, lists, and retrieves a funnel", async () => {
      const projects = await client.listProjects();
      const projectId = projects[0].id;
      const slug = `cli-test-${Date.now()}`;

      const created = await client.createFunnel(projectId, {
        name: "CLI Test Funnel",
        slug,
        steps: [
          { name: "step-one", event_filter: { step_name: "step-one" } },
          { name: "step-two", event_filter: { step_name: "step-two" } },
        ],
      });
      expect(created.slug).toBe(slug);

      const list = await client.listFunnels(projectId);
      expect(list.funnels.some((f) => f.slug === slug)).toBe(true);

      const fetched = await client.getFunnel(slug, projectId);
      expect(fetched.slug).toBe(slug);
      expect(fetched.steps).toHaveLength(2);
    });
  });

  // --- Audit Logs ---

  describe("audit logs", () => {
    it("queries audit logs", async () => {
      const teamId = process.env.OWLMETRY_TEST_TEAM_ID!;
      const result = await client.queryAuditLogs(teamId, {});
      expect(result).toHaveProperty("audit_logs");
      expect(result).toHaveProperty("has_more");
      expect(Array.isArray(result.audit_logs)).toBe(true);
    });
  });

  // --- Error handling ---

  describe("errors", () => {
    it("throws ApiError on 404", async () => {
      try {
        await client.getProject("00000000-0000-0000-0000-000000000000");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(404);
      }
    });
  });
});
