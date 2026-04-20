import type {
  AppResponse,
  AppUsersResponse,
  AppUsersQueryParams,
  AttachmentListResponse,
  AttachmentQuotaUsage,
  AttachmentSummary,
  AuditLogsQueryParams,
  AuditLogsResponse,
  CreateAppRequest,
  CreateProjectRequest,
  CreateMetricDefinitionRequest,
  UpdateMetricDefinitionRequest,
  CreateFunnelRequest,
  UpdateFunnelRequest,
  CreateIntegrationRequest,
  CreateIntegrationResponse,
  UpdateIntegrationRequest,
  IntegrationResponse,
  EventsQueryParams,
  EventsResponse,
  FunnelDefinitionResponse,
  FunnelQueryParams,
  FunnelQueryResponse,
  IssuesQueryParams,
  IssuesResponse,
  IssueDetailResponse,
  IssueResponse,
  IssueCommentResponse,
  UpdateIssueRequest,
  MergeIssuesRequest,
  CreateIssueCommentRequest,
  JobRunResponse,
  JobRunsQueryParams,
  JobRunsResponse,
  TriggerJobRequest,
  TriggerJobResponse,
  MetricDefinitionResponse,
  MetricQueryParams,
  MetricQueryResponse,
  MetricEventsQueryParams,
  MetricEventsResponse,
  ProjectResponse,
  ProjectDetailResponse,
  StoredEventResponse,
  UpdateAppRequest,
  UpdateProjectRequest,
} from "@owlmetry/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class OwlMetryClient {
  private endpoint: string;
  private apiKey: string;

  constructor(opts: { endpoint: string; apiKey: string }) {
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; params?: Record<string, string | undefined> },
  ): Promise<T> {
    const url = new URL(path, this.endpoint);
    if (opts?.params) {
      for (const [key, value] of Object.entries(opts.params)) {
        if (value !== undefined) url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    let bodyStr: string | undefined;
    if (opts?.body) {
      headers["Content-Type"] = "application/json";
      bodyStr = JSON.stringify(opts.body);
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: bodyStr,
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // use statusText
      }
      throw new ApiError(response.status, message);
    }

    return (await response.json()) as T;
  }

  // Auth
  async whoami(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/v1/auth/whoami");
  }

  // Projects
  async listProjects(): Promise<ProjectResponse[]> {
    const result = await this.request<{ projects: ProjectResponse[] }>("GET", "/v1/projects");
    return result.projects;
  }

  async getProject(id: string): Promise<ProjectDetailResponse> {
    return this.request<ProjectDetailResponse>("GET", `/v1/projects/${id}`);
  }

  async createProject(body: CreateProjectRequest): Promise<ProjectResponse> {
    return this.request<ProjectResponse>("POST", "/v1/projects", { body });
  }

  async updateProject(id: string, body: UpdateProjectRequest): Promise<ProjectResponse> {
    return this.request<ProjectResponse>("PATCH", `/v1/projects/${id}`, { body });
  }

  // Apps
  async listApps(): Promise<AppResponse[]> {
    const result = await this.request<{ apps: AppResponse[] }>("GET", "/v1/apps");
    return result.apps;
  }

  async getApp(id: string): Promise<AppResponse> {
    return this.request<AppResponse>("GET", `/v1/apps/${id}`);
  }

  async createApp(body: CreateAppRequest): Promise<AppResponse> {
    return this.request<AppResponse>("POST", "/v1/apps", { body });
  }

  async updateApp(id: string, body: UpdateAppRequest): Promise<AppResponse> {
    return this.request<AppResponse>("PATCH", `/v1/apps/${id}`, { body });
  }

  // App Users
  async listAppUsers(appId: string, params: AppUsersQueryParams = {}): Promise<AppUsersResponse> {
    const stringParams: Record<string, string | undefined> = {
      search: params.search,
      is_anonymous: params.is_anonymous,
      billing_status: params.billing_status,
      cursor: params.cursor,
      limit: params.limit?.toString(),
    };
    return this.request<AppUsersResponse>("GET", `/v1/apps/${appId}/users`, { params: stringParams });
  }

  // Events
  async queryEvents(params: EventsQueryParams): Promise<EventsResponse> {
    const stringParams: Record<string, string | undefined> = {
      project_id: params.project_id,
      app_id: params.app_id,
      level: params.level,
      user_id: params.user_id,
      session_id: params.session_id,
      screen_name: params.screen_name,
      since: params.since,
      until: params.until,
      cursor: params.cursor,
      limit: params.limit?.toString(),
      data_mode: params.data_mode,
      order: params.order,
    };
    return this.request<EventsResponse>("GET", "/v1/events", { params: stringParams });
  }

  async getEvent(id: string): Promise<StoredEventResponse> {
    return this.request<StoredEventResponse>("GET", `/v1/events/${id}`);
  }

  // Metrics
  async listMetrics(projectId: string): Promise<MetricDefinitionResponse[]> {
    const result = await this.request<{ metrics: MetricDefinitionResponse[] }>("GET", `/v1/projects/${projectId}/metrics`);
    return result.metrics;
  }

  async getMetric(slug: string, projectId: string): Promise<MetricDefinitionResponse> {
    return this.request<MetricDefinitionResponse>("GET", `/v1/projects/${projectId}/metrics/${slug}`);
  }

  async createMetric(projectId: string, body: CreateMetricDefinitionRequest): Promise<MetricDefinitionResponse> {
    return this.request<MetricDefinitionResponse>("POST", `/v1/projects/${projectId}/metrics`, { body });
  }

  async updateMetric(slug: string, projectId: string, body: UpdateMetricDefinitionRequest): Promise<MetricDefinitionResponse> {
    return this.request<MetricDefinitionResponse>("PATCH", `/v1/projects/${projectId}/metrics/${slug}`, { body });
  }

  async deleteMetric(slug: string, projectId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>("DELETE", `/v1/projects/${projectId}/metrics/${slug}`);
  }

  async queryMetricEvents(slug: string, projectId: string, params: Partial<MetricEventsQueryParams> = {}): Promise<MetricEventsResponse> {
    const stringParams: Record<string, string | undefined> = {
      phase: params.phase,
      tracking_id: params.tracking_id,
      user_id: params.user_id,
      environment: params.environment,
      since: params.since,
      until: params.until,
      cursor: params.cursor,
      limit: params.limit?.toString(),
      data_mode: params.data_mode,
    };
    return this.request<MetricEventsResponse>("GET", `/v1/projects/${projectId}/metrics/${slug}/events`, { params: stringParams });
  }

  async queryMetric(slug: string, projectId: string, params: Partial<MetricQueryParams> = {}): Promise<MetricQueryResponse> {
    const stringParams: Record<string, string | undefined> = {
      since: params.since,
      until: params.until,
      app_id: params.app_id,
      app_version: params.app_version,
      device_model: params.device_model,
      os_version: params.os_version,
      user_id: params.user_id,
      environment: params.environment,
      data_mode: params.data_mode,
      group_by: params.group_by,
    };
    return this.request<MetricQueryResponse>("GET", `/v1/projects/${projectId}/metrics/${slug}/query`, { params: stringParams });
  }

  // Funnels
  async listFunnels(projectId: string): Promise<{ funnels: FunnelDefinitionResponse[] }> {
    return this.request<{ funnels: FunnelDefinitionResponse[] }>("GET", `/v1/projects/${projectId}/funnels`);
  }

  async getFunnel(slug: string, projectId: string): Promise<FunnelDefinitionResponse> {
    return this.request<FunnelDefinitionResponse>("GET", `/v1/projects/${projectId}/funnels/${slug}`);
  }

  async createFunnel(projectId: string, body: CreateFunnelRequest): Promise<FunnelDefinitionResponse> {
    return this.request<FunnelDefinitionResponse>("POST", `/v1/projects/${projectId}/funnels`, { body });
  }

  async updateFunnel(slug: string, projectId: string, body: UpdateFunnelRequest): Promise<FunnelDefinitionResponse> {
    return this.request<FunnelDefinitionResponse>("PATCH", `/v1/projects/${projectId}/funnels/${slug}`, { body });
  }

  async deleteFunnel(slug: string, projectId: string): Promise<{ deleted: true }> {
    return this.request<{ deleted: true }>("DELETE", `/v1/projects/${projectId}/funnels/${slug}`);
  }

  async queryFunnel(slug: string, projectId: string, params: Partial<FunnelQueryParams> = {}): Promise<FunnelQueryResponse> {
    const stringParams: Record<string, string | undefined> = {
      since: params.since,
      until: params.until,
      app_id: params.app_id,
      app_version: params.app_version,
      environment: params.environment,
      experiment: params.experiment,
      mode: params.mode,
      group_by: params.group_by,
      data_mode: params.data_mode,
    };
    return this.request<FunnelQueryResponse>("GET", `/v1/projects/${projectId}/funnels/${slug}/query`, { params: stringParams });
  }

  // Integrations
  async listIntegrations(projectId: string): Promise<IntegrationResponse[]> {
    const result = await this.request<{ integrations: IntegrationResponse[] }>("GET", `/v1/projects/${projectId}/integrations`);
    return result.integrations;
  }

  async createIntegration(projectId: string, body: CreateIntegrationRequest): Promise<CreateIntegrationResponse> {
    return this.request<IntegrationResponse>("POST", `/v1/projects/${projectId}/integrations`, { body });
  }

  async updateIntegration(provider: string, projectId: string, body: UpdateIntegrationRequest): Promise<IntegrationResponse> {
    return this.request<IntegrationResponse>("PATCH", `/v1/projects/${projectId}/integrations/${provider}`, { body });
  }

  async deleteIntegration(provider: string, projectId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>("DELETE", `/v1/projects/${projectId}/integrations/${provider}`);
  }

  // RevenueCat Sync
  async syncRevenueCat(projectId: string): Promise<{ syncing: boolean; total: number }> {
    return this.request<{ syncing: boolean; total: number }>("POST", `/v1/projects/${projectId}/integrations/revenuecat/sync`);
  }

  async syncRevenueCatUser(projectId: string, userId: string): Promise<{ updated: number; properties: Record<string, string> }> {
    return this.request<{ updated: number; properties: Record<string, string> }>("POST", `/v1/projects/${projectId}/integrations/revenuecat/sync/${encodeURIComponent(userId)}`);
  }

  // Jobs
  async listJobRuns(teamId: string, params: Partial<JobRunsQueryParams> = {}): Promise<JobRunsResponse> {
    const stringParams: Record<string, string | undefined> = {
      job_type: params.job_type,
      status: params.status,
      project_id: params.project_id,
      since: params.since,
      until: params.until,
      cursor: params.cursor,
      limit: params.limit,
    };
    return this.request<JobRunsResponse>("GET", `/v1/teams/${teamId}/jobs`, { params: stringParams });
  }

  async getJobRun(runId: string): Promise<{ job_run: JobRunResponse }> {
    return this.request<{ job_run: JobRunResponse }>("GET", `/v1/jobs/${runId}`);
  }

  async triggerJob(teamId: string, body: TriggerJobRequest): Promise<TriggerJobResponse> {
    return this.request<TriggerJobResponse>("POST", `/v1/teams/${teamId}/jobs/trigger`, { body });
  }

  async cancelJob(runId: string): Promise<{ cancelled: boolean }> {
    return this.request<{ cancelled: boolean }>("POST", `/v1/jobs/${runId}/cancel`);
  }

  // Issues
  async listIssues(projectId: string, params: Partial<IssuesQueryParams> = {}): Promise<IssuesResponse> {
    return this.request<IssuesResponse>("GET", `/v1/projects/${projectId}/issues`, { params: params as Record<string, string> });
  }

  async getIssue(projectId: string, issueId: string): Promise<IssueDetailResponse> {
    return this.request<IssueDetailResponse>("GET", `/v1/projects/${projectId}/issues/${issueId}`);
  }

  async updateIssue(projectId: string, issueId: string, body: UpdateIssueRequest): Promise<IssueResponse> {
    return this.request<IssueResponse>("PATCH", `/v1/projects/${projectId}/issues/${issueId}`, { body });
  }

  async mergeIssues(projectId: string, targetId: string, body: MergeIssuesRequest): Promise<IssueResponse> {
    return this.request<IssueResponse>("POST", `/v1/projects/${projectId}/issues/${targetId}/merge`, { body });
  }

  async listIssueComments(projectId: string, issueId: string): Promise<{ comments: IssueCommentResponse[] }> {
    return this.request<{ comments: IssueCommentResponse[] }>("GET", `/v1/projects/${projectId}/issues/${issueId}/comments`);
  }

  async addIssueComment(projectId: string, issueId: string, body: CreateIssueCommentRequest): Promise<IssueCommentResponse> {
    return this.request<IssueCommentResponse>("POST", `/v1/projects/${projectId}/issues/${issueId}/comments`, { body });
  }

  // Attachments
  async listAttachments(params: {
    project_id?: string;
    event_id?: string;
    event_client_id?: string;
    issue_id?: string;
    cursor?: string;
    limit?: number;
  }): Promise<AttachmentListResponse> {
    const stringParams: Record<string, string | undefined> = {
      project_id: params.project_id,
      event_id: params.event_id,
      event_client_id: params.event_client_id,
      issue_id: params.issue_id,
      cursor: params.cursor,
      limit: params.limit?.toString(),
    };
    return this.request<AttachmentListResponse>("GET", "/v1/attachments", { params: stringParams });
  }

  async getAttachment(
    id: string,
  ): Promise<AttachmentSummary & { download_url?: { url: string; expires_at: string; original_filename: string; content_type: string; size_bytes: number } }> {
    return this.request<AttachmentSummary & { download_url?: { url: string; expires_at: string; original_filename: string; content_type: string; size_bytes: number } }>(
      "GET",
      `/v1/attachments/${id}`
    );
  }

  async deleteAttachment(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("DELETE", `/v1/attachments/${id}`);
  }

  async getAttachmentUsage(projectId: string, userId?: string): Promise<AttachmentQuotaUsage> {
    const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
    return this.request<AttachmentQuotaUsage>(
      "GET",
      `/v1/projects/${projectId}/attachment-usage${qs}`
    );
  }

  async downloadAttachmentBytes(downloadUrl: string): Promise<Uint8Array> {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new ApiError(response.status, `Download failed: ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  // Audit Logs
  async queryAuditLogs(teamId: string, params: AuditLogsQueryParams): Promise<AuditLogsResponse> {
    const stringParams: Record<string, string | undefined> = {
      resource_type: params.resource_type,
      resource_id: params.resource_id,
      actor_id: params.actor_id,
      action: params.action,
      since: params.since,
      until: params.until,
      cursor: params.cursor,
      limit: params.limit?.toString(),
    };
    return this.request<AuditLogsResponse>("GET", `/v1/teams/${teamId}/audit-logs`, { params: stringParams });
  }
}
