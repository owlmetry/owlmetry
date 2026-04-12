import { OwlMetryClient, ApiError } from "../client.js";
import {
  mockFetchJson,
  mockFetchError,
  mockFetchNetworkError,
  mockFetchNonJsonError,
  getLastFetchCall,
  resetFetchMock,
} from "./helpers/mock-fetch.js";
import { PROJECT, APP, EVENT, METRIC_DEFINITION, FUNNEL_DEFINITION, AUDIT_LOG, METRIC_EVENT } from "./helpers/fixtures.js";

const ENDPOINT = "http://localhost:4000";
const API_KEY = "owl_agent_testkey123";

function makeClient(endpoint = ENDPOINT) {
  return new OwlMetryClient({ endpoint, apiKey: API_KEY });
}

beforeEach(() => {
  resetFetchMock();
});

// --- Constructor ---

describe("constructor", () => {
  it("strips trailing slashes from endpoint", () => {
    mockFetchJson({ projects: [] });
    const client = makeClient("http://localhost:4000///");
    client.listProjects();
    const call = getLastFetchCall();
    expect(call.url).toMatch(/^http:\/\/localhost:4000\/v1\/projects/);
  });
});

// --- Request infrastructure ---

describe("request infrastructure", () => {
  it("sends Authorization header on every request", async () => {
    mockFetchJson({ projects: [] });
    await makeClient().listProjects();
    expect(getLastFetchCall().headers.Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it("sends Content-Type only when body is present", async () => {
    mockFetchJson({ projects: [] });
    await makeClient().listProjects();
    expect(getLastFetchCall().headers["Content-Type"]).toBeUndefined();

    resetFetchMock();
    mockFetchJson(PROJECT);
    await makeClient().createProject({ name: "X", team_id: "t1" });
    expect(getLastFetchCall().headers["Content-Type"]).toBe("application/json");
  });

  it("omits undefined query params", async () => {
    mockFetchJson({ events: [], cursor: null, has_more: false });
    await makeClient().queryEvents({ level: "error" });
    const url = getLastFetchCall().url;
    expect(url).toContain("level=error");
    expect(url).not.toContain("undefined");
    expect(url).not.toContain("app_id=");
  });
});

// --- Error handling ---

describe("error handling", () => {
  it("throws ApiError with status and server message on non-200", async () => {
    mockFetchError(404, { error: "Project not found" });
    await expect(makeClient().getProject("xxx")).rejects.toThrow(ApiError);
    try {
      await makeClient().getProject("xxx");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).message).toBe("Project not found");
    }
  });

  it("falls back to statusText when error body is not JSON", async () => {
    mockFetchNonJsonError(502, "Bad Gateway");
    await expect(makeClient().getProject("xxx")).rejects.toThrow("Bad Gateway");
  });

  it("propagates network errors", async () => {
    mockFetchNetworkError("fetch failed");
    await expect(makeClient().listProjects()).rejects.toThrow("fetch failed");
  });
});

// --- Projects ---

describe("listProjects", () => {
  it("GET /v1/projects and unwraps result", async () => {
    mockFetchJson({ projects: [PROJECT] });
    const result = await makeClient().listProjects();
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects`);
    expect(result).toEqual([PROJECT]);
  });
});

describe("getProject", () => {
  it("GET /v1/projects/:id", async () => {
    mockFetchJson({ ...PROJECT, apps: [] });
    await makeClient().getProject("p-123");
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-123`);
  });
});

describe("createProject", () => {
  it("POST /v1/projects with body", async () => {
    mockFetchJson(PROJECT);
    const body = { name: "New Project", team_id: "t-1" };
    await makeClient().createProject(body);
    const call = getLastFetchCall();
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects`);
    expect(call.body).toEqual(body);
  });
});

describe("updateProject", () => {
  it("PATCH /v1/projects/:id with body", async () => {
    mockFetchJson(PROJECT);
    const body = { name: "Updated" };
    await makeClient().updateProject("p-123", body);
    const call = getLastFetchCall();
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-123`);
    expect(call.body).toEqual(body);
  });
});

// --- Apps ---

describe("listApps", () => {
  it("GET /v1/apps and unwraps result", async () => {
    mockFetchJson({ apps: [APP] });
    const result = await makeClient().listApps();
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${ENDPOINT}/v1/apps`);
    expect(result).toEqual([APP]);
  });
});

describe("getApp", () => {
  it("GET /v1/apps/:id", async () => {
    mockFetchJson(APP);
    await makeClient().getApp("a-123");
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${ENDPOINT}/v1/apps/a-123`);
  });
});

describe("createApp", () => {
  it("POST /v1/apps with body", async () => {
    mockFetchJson(APP);
    const body = { name: "New App", platform: "apple" as const, project_id: "p-1", bundle_id: "com.test" };
    await makeClient().createApp(body);
    const call = getLastFetchCall();
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${ENDPOINT}/v1/apps`);
    expect(call.body).toEqual(body);
  });
});

describe("updateApp", () => {
  it("PATCH /v1/apps/:id with body", async () => {
    mockFetchJson(APP);
    await makeClient().updateApp("a-123", { name: "Renamed" });
    const call = getLastFetchCall();
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(`${ENDPOINT}/v1/apps/a-123`);
    expect(call.body).toEqual({ name: "Renamed" });
  });
});

// --- App Users ---

describe("listAppUsers", () => {
  it("GET /v1/apps/:appId/users with params", async () => {
    mockFetchJson({ users: [], cursor: null, has_more: false });
    await makeClient().listAppUsers("a-123", { search: "john", is_anonymous: "true", limit: 10 });
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toContain("/v1/apps/a-123/users");
    expect(call.url).toContain("search=john");
    expect(call.url).toContain("is_anonymous=true");
    expect(call.url).toContain("limit=10");
  });

  it("omits undefined params", async () => {
    mockFetchJson({ users: [], cursor: null, has_more: false });
    await makeClient().listAppUsers("a-123");
    const url = getLastFetchCall().url;
    expect(url).not.toContain("search=");
    expect(url).not.toContain("limit=");
  });
});

// --- Events ---

describe("queryEvents", () => {
  it("GET /v1/events with all filter params", async () => {
    mockFetchJson({ events: [EVENT], cursor: null, has_more: false });
    await makeClient().queryEvents({
      project_id: "p-1",
      app_id: "a-1",
      level: "error",
      user_id: "u-1",
      session_id: "s-1",
      screen_name: "Home",
      since: "2025-01-01T00:00:00Z",
      until: "2025-01-31T00:00:00Z",
      cursor: "abc",
      limit: 50,
      data_mode: "production",
    });
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toContain("/v1/events");
    expect(call.url).toContain("project_id=p-1");
    expect(call.url).toContain("level=error");
    expect(call.url).toContain("user_id=u-1");
    expect(call.url).toContain("session_id=s-1");
    expect(call.url).toContain("screen_name=Home");
    expect(call.url).toContain("cursor=abc");
    expect(call.url).toContain("limit=50");
    expect(call.url).toContain("data_mode=production");
  });

  it("returns events response", async () => {
    const response = { events: [EVENT], cursor: "next", has_more: true };
    mockFetchJson(response);
    const result = await makeClient().queryEvents({});
    expect(result).toEqual(response);
  });
});

describe("getEvent", () => {
  it("GET /v1/events/:id", async () => {
    mockFetchJson(EVENT);
    await makeClient().getEvent("e-123");
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${ENDPOINT}/v1/events/e-123`);
  });
});

// --- Metrics ---

describe("listMetrics", () => {
  it("GET /v1/projects/:projectId/metrics and unwraps", async () => {
    mockFetchJson({ metrics: [METRIC_DEFINITION] });
    const result = await makeClient().listMetrics("p-1");
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-1/metrics`);
    expect(result).toEqual([METRIC_DEFINITION]);
  });
});

describe("getMetric", () => {
  it("GET /v1/projects/:projectId/metrics/:slug", async () => {
    mockFetchJson(METRIC_DEFINITION);
    await makeClient().getMetric("app-launch", "p-1");
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-1/metrics/app-launch`);
  });
});

describe("createMetric", () => {
  it("POST /v1/projects/:projectId/metrics with body", async () => {
    mockFetchJson(METRIC_DEFINITION);
    const body = { name: "App Launch", slug: "app-launch" };
    await makeClient().createMetric("p-1", body);
    const call = getLastFetchCall();
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-1/metrics`);
    expect(call.body).toEqual(body);
  });
});

describe("updateMetric", () => {
  it("PATCH /v1/projects/:projectId/metrics/:slug with body", async () => {
    mockFetchJson(METRIC_DEFINITION);
    await makeClient().updateMetric("app-launch", "p-1", { name: "Renamed" });
    const call = getLastFetchCall();
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-1/metrics/app-launch`);
    expect(call.body).toEqual({ name: "Renamed" });
  });
});

describe("deleteMetric", () => {
  it("DELETE /v1/projects/:projectId/metrics/:slug", async () => {
    mockFetchJson({ deleted: true });
    await makeClient().deleteMetric("app-launch", "p-1");
    const call = getLastFetchCall();
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-1/metrics/app-launch`);
  });
});

describe("queryMetricEvents", () => {
  it("GET /v1/projects/:projectId/metrics/:slug/events with params", async () => {
    mockFetchJson({ events: [METRIC_EVENT], cursor: null, has_more: false });
    await makeClient().queryMetricEvents("app-launch", "p-1", {
      phase: "complete",
      tracking_id: "tid-1",
      user_id: "u-1",
      environment: "ios",
      since: "2025-01-01T00:00:00Z",
      limit: 20,
      data_mode: "production",
    });
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toContain("/v1/projects/p-1/metrics/app-launch/events");
    expect(call.url).toContain("phase=complete");
    expect(call.url).toContain("tracking_id=tid-1");
    expect(call.url).toContain("environment=ios");
    expect(call.url).toContain("limit=20");
  });

  it("works with no params", async () => {
    mockFetchJson({ events: [], cursor: null, has_more: false });
    await makeClient().queryMetricEvents("app-launch", "p-1");
    const url = getLastFetchCall().url;
    expect(url).toBe(`${ENDPOINT}/v1/projects/p-1/metrics/app-launch/events`);
  });
});

describe("queryMetric", () => {
  it("GET /v1/projects/:projectId/metrics/:slug/query with params", async () => {
    mockFetchJson({ slug: "app-launch", aggregation: {} });
    await makeClient().queryMetric("app-launch", "p-1", {
      since: "2025-01-01T00:00:00Z",
      app_id: "a-1",
      environment: "ios",
      group_by: "environment",
      data_mode: "all",
    });
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toContain("/v1/projects/p-1/metrics/app-launch/query");
    expect(call.url).toContain("environment=ios");
    expect(call.url).toContain("group_by=environment");
    expect(call.url).toContain("data_mode=all");
  });
});

// --- Funnels ---

describe("listFunnels", () => {
  it("GET /v1/projects/:projectId/funnels — does NOT unwrap", async () => {
    const response = { funnels: [FUNNEL_DEFINITION] };
    mockFetchJson(response);
    const result = await makeClient().listFunnels("p-1");
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-1/funnels`);
    expect(result).toEqual(response);
  });
});

describe("getFunnel", () => {
  it("GET /v1/projects/:projectId/funnels/:slug", async () => {
    mockFetchJson(FUNNEL_DEFINITION);
    await makeClient().getFunnel("onboarding", "p-1");
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-1/funnels/onboarding`);
  });
});

describe("createFunnel", () => {
  it("POST /v1/projects/:projectId/funnels with body", async () => {
    mockFetchJson(FUNNEL_DEFINITION);
    const body = {
      name: "Onboarding",
      slug: "onboarding",
      steps: [{ name: "signup", event_filter: { step_name: "signup" } }],
    };
    await makeClient().createFunnel("p-1", body);
    const call = getLastFetchCall();
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-1/funnels`);
    expect(call.body).toEqual(body);
  });
});

describe("updateFunnel", () => {
  it("PATCH /v1/projects/:projectId/funnels/:slug with body", async () => {
    mockFetchJson(FUNNEL_DEFINITION);
    await makeClient().updateFunnel("onboarding", "p-1", { name: "Updated" });
    const call = getLastFetchCall();
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-1/funnels/onboarding`);
    expect(call.body).toEqual({ name: "Updated" });
  });
});

describe("deleteFunnel", () => {
  it("DELETE /v1/projects/:projectId/funnels/:slug", async () => {
    mockFetchJson({ deleted: true });
    await makeClient().deleteFunnel("onboarding", "p-1");
    const call = getLastFetchCall();
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe(`${ENDPOINT}/v1/projects/p-1/funnels/onboarding`);
  });
});

describe("queryFunnel", () => {
  it("GET /v1/projects/:projectId/funnels/:slug/query with params", async () => {
    mockFetchJson({ slug: "onboarding", analytics: {} });
    await makeClient().queryFunnel("onboarding", "p-1", {
      since: "2025-01-01T00:00:00Z",
      app_id: "a-1",
      app_version: "1.0.0",
      environment: "ios",
      experiment: "exp:variant-a",
      mode: "closed",
      group_by: "environment",
      data_mode: "production",
    });
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toContain("/v1/projects/p-1/funnels/onboarding/query");
    expect(call.url).toContain("mode=closed");
    expect(call.url).toContain("group_by=environment");
    expect(call.url).toContain("data_mode=production");
  });
});

// --- Audit Logs ---

// --- Issues ---

describe("listIssues", () => {
  it("GET /v1/projects/:projectId/issues with params", async () => {
    mockFetchJson({ issues: [], cursor: null, has_more: false });
    await makeClient().listIssues("p-1", { status: "new", app_id: "a-1", limit: "10" });
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toContain("/v1/projects/p-1/issues");
    expect(call.url).toContain("status=new");
    expect(call.url).toContain("app_id=a-1");
    expect(call.url).toContain("limit=10");
  });
});

describe("getIssue", () => {
  it("GET /v1/projects/:projectId/issues/:issueId", async () => {
    mockFetchJson({ id: "i-1", status: "new", occurrences: [], comments: [], fingerprints: [] });
    await makeClient().getIssue("p-1", "i-1");
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toContain("/v1/projects/p-1/issues/i-1");
  });
});

describe("updateIssue", () => {
  it("PATCH /v1/projects/:projectId/issues/:issueId with status", async () => {
    mockFetchJson({ id: "i-1", status: "resolved" });
    await makeClient().updateIssue("p-1", "i-1", { status: "resolved", resolved_at_version: "2.0.0" });
    const call = getLastFetchCall();
    expect(call.method).toBe("PATCH");
    expect(call.url).toContain("/v1/projects/p-1/issues/i-1");
    expect(call.body.status).toBe("resolved");
    expect(call.body.resolved_at_version).toBe("2.0.0");
  });
});

describe("mergeIssues", () => {
  it("POST /v1/projects/:projectId/issues/:targetId/merge", async () => {
    mockFetchJson({ id: "target-1", fingerprints: ["fp1", "fp2"] });
    await makeClient().mergeIssues("p-1", "target-1", { source_issue_id: "source-1" });
    const call = getLastFetchCall();
    expect(call.method).toBe("POST");
    expect(call.url).toContain("/v1/projects/p-1/issues/target-1/merge");
    expect(call.body.source_issue_id).toBe("source-1");
  });
});

describe("addIssueComment", () => {
  it("POST /v1/projects/:projectId/issues/:issueId/comments", async () => {
    mockFetchJson({ id: "c-1", body: "test comment", author_type: "agent" });
    await makeClient().addIssueComment("p-1", "i-1", { body: "test comment" });
    const call = getLastFetchCall();
    expect(call.method).toBe("POST");
    expect(call.url).toContain("/v1/projects/p-1/issues/i-1/comments");
    expect(call.body.body).toBe("test comment");
  });
});

describe("listIssueComments", () => {
  it("GET /v1/projects/:projectId/issues/:issueId/comments", async () => {
    mockFetchJson({ comments: [] });
    await makeClient().listIssueComments("p-1", "i-1");
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toContain("/v1/projects/p-1/issues/i-1/comments");
  });
});

describe("queryAuditLogs", () => {
  it("GET /v1/teams/:teamId/audit-logs with params", async () => {
    mockFetchJson({ audit_logs: [AUDIT_LOG], cursor: null, has_more: false });
    await makeClient().queryAuditLogs("t-1", {
      resource_type: "project",
      action: "create",
      limit: 25,
    });
    const call = getLastFetchCall();
    expect(call.method).toBe("GET");
    expect(call.url).toContain("/v1/teams/t-1/audit-logs");
    expect(call.url).toContain("resource_type=project");
    expect(call.url).toContain("action=create");
    expect(call.url).toContain("limit=25");
  });

  it("omits undefined params", async () => {
    mockFetchJson({ audit_logs: [], cursor: null, has_more: false });
    await makeClient().queryAuditLogs("t-1", {});
    const url = getLastFetchCall().url;
    expect(url).toBe(`${ENDPOINT}/v1/teams/t-1/audit-logs`);
  });
});
