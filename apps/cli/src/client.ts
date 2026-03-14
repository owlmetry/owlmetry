import type {
  AppResponse,
  CreateAppRequest,
  CreateProjectRequest,
  EventsQueryParams,
  EventsResponse,
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
    };
    return this.request<EventsResponse>("GET", "/v1/events", { params: stringParams });
  }

  async getEvent(id: string): Promise<StoredEventResponse> {
    return this.request<StoredEventResponse>("GET", `/v1/events/${id}`);
  }
}
