# MCP Server for OwlMetry — Implementation Plan

## Why Remote MCP (not local)

A remote MCP server hosted alongside the existing Fastify API solves the core
pain: users configure a URL once and every feature update is live immediately.
No npm updates, no skill file refreshes, no version mismatches.

## What's Involved

### SDK & Transport

- **Package**: `@modelcontextprotocol/sdk` (v1 stable, peer dep on `zod`)
- **Transport**: `StreamableHTTPServerTransport` — Streamable HTTP
- **Endpoint**: Single path (e.g. `/mcp`) handling POST, GET, and DELETE
- **Protocol**: JSON-RPC 2.0 over HTTP, optional SSE for streaming

### Fastify Integration

The SDK works with raw Node.js `IncomingMessage`/`ServerResponse`. In Fastify
use `request.raw` and `reply.raw`:

```ts
fastify.route({
  method: ['GET', 'POST', 'DELETE'],
  url: '/mcp',
  handler: async (request, reply) => {
    // Use request.raw / reply.raw with the MCP transport
    await transport.handleRequest(request.raw, reply.raw, request.body);
  }
});
```

### Stateless vs Stateful

**Recommended: Stateless** (`sessionIdGenerator: undefined`). Each request
creates a fresh McpServer + transport. No session tracking needed since all
state lives in the database. Simpler, no cleanup, scales horizontally.

Can also use `enableJsonResponse: true` to skip SSE entirely — plain JSON
responses for every POST.

### Authentication

Bearer token via existing `owl_agent_*` API keys. Extract from the
`Authorization` header before passing to tool handlers. The MCP spec supports
bearer auth natively.

### Tool Registration

Tools are defined with Zod schemas (auto-converted to JSON Schema for the
protocol). The handler receives typed, validated input:

```ts
server.registerTool(
  'list-projects',
  {
    description: 'List all projects',
    inputSchema: z.object({
      team_id: z.string().optional()
    })
  },
  async ({ team_id }, ctx) => {
    // Call existing service/route logic
    const projects = await projectService.list(authContext, { team_id });
    return {
      content: [{ type: 'text', text: JSON.stringify(projects) }]
    };
  }
);
```

---

## CLI → MCP Tool Mapping

Every CLI command maps to an MCP tool wrapping the same API endpoint.

### Authentication

| CLI Command | MCP Tool | API Route | Method |
|---|---|---|---|
| `whoami` | `whoami` | `/v1/auth/whoami` | GET |

> `auth send-code` and `auth verify` are not needed — MCP clients authenticate
> with an existing API key.

### Projects

| CLI Command | MCP Tool | API Route | Method |
|---|---|---|---|
| `projects` | `list-projects` | `/v1/projects` | GET |
| `projects view <id>` | `get-project` | `/v1/projects/:id` | GET |
| `projects create` | `create-project` | `/v1/projects` | POST |
| `projects update <id>` | `update-project` | `/v1/projects/:id` | PATCH |

### Apps

| CLI Command | MCP Tool | API Route | Method |
|---|---|---|---|
| `apps list` | `list-apps` | `/v1/apps` | GET |
| `apps view <id>` | `get-app` | `/v1/apps/:id` | GET |
| `apps create` | `create-app` | `/v1/apps` | POST |
| `apps update <id>` | `update-app` | `/v1/apps/:id` | PATCH |
| `users <app-id>` | `list-users` | `/v1/apps/:id/users` | GET |

### Events

| CLI Command | MCP Tool | API Route | Method |
|---|---|---|---|
| `events` | `query-events` | `/v1/events` | GET |
| `events view <id>` | `get-event` | `/v1/events/:id` | GET |
| `investigate <id>` | `investigate-event` | `/v1/events` (filtered) | GET |

### Metrics

| CLI Command | MCP Tool | API Route | Method |
|---|---|---|---|
| `metrics list` | `list-metrics` | `/v1/projects/:id/metrics` | GET |
| `metrics view <slug>` | `get-metric` | `/v1/projects/:id/metrics/:slug` | GET |
| `metrics create` | `create-metric` | `/v1/projects/:id/metrics` | POST |
| `metrics update <slug>` | `update-metric` | `/v1/projects/:id/metrics/:slug` | PATCH |
| `metrics delete <slug>` | `delete-metric` | `/v1/projects/:id/metrics/:slug` | DELETE |
| `metrics query <slug>` | `query-metric` | `/v1/projects/:id/metrics/:slug/query` | GET |
| `metrics events <slug>` | `list-metric-events` | `/v1/projects/:id/metrics/:slug/events` | GET |

### Funnels

| CLI Command | MCP Tool | API Route | Method |
|---|---|---|---|
| `funnels list` | `list-funnels` | `/v1/projects/:id/funnels` | GET |
| `funnels view <slug>` | `get-funnel` | `/v1/projects/:id/funnels/:slug` | GET |
| `funnels create` | `create-funnel` | `/v1/projects/:id/funnels` | POST |
| `funnels update <slug>` | `update-funnel` | `/v1/projects/:id/funnels/:slug` | PATCH |
| `funnels delete <slug>` | `delete-funnel` | `/v1/projects/:id/funnels/:slug` | DELETE |
| `funnels query <slug>` | `query-funnel` | `/v1/projects/:id/funnels/:slug/query` | GET |

### Integrations

| CLI Command | MCP Tool | API Route | Method |
|---|---|---|---|
| `integrations providers` | `list-providers` | `/v1/integrations/providers` | GET |
| `integrations list` | `list-integrations` | `/v1/projects/:id/integrations` | GET |
| `integrations add <p>` | `add-integration` | `/v1/projects/:id/integrations` | POST |
| `integrations update <p>` | `update-integration` | `/v1/projects/:id/integrations/:p` | PATCH |
| `integrations remove <p>` | `remove-integration` | `/v1/projects/:id/integrations/:p` | DELETE |
| `integrations sync <p>` | `sync-integration` | `/v1/projects/:id/integrations/revenuecat/sync` | POST |

### Jobs

| CLI Command | MCP Tool | API Route | Method |
|---|---|---|---|
| `jobs list` | `list-jobs` | `/v1/teams/:id/jobs` | GET |
| `jobs view <runId>` | `get-job` | `/v1/jobs/:runId` | GET |
| `jobs trigger <type>` | `trigger-job` | `/v1/teams/:id/jobs/trigger` | POST |
| `jobs cancel <runId>` | `cancel-job` | `/v1/jobs/:runId/cancel` | POST |

### Audit Logs

| CLI Command | MCP Tool | API Route | Method |
|---|---|---|---|
| `audit-log list` | `list-audit-logs` | `/v1/teams/:id/audit-logs` | GET |

---

## Implementation Approach

### 1. Add dependencies to `apps/server`

```bash
npm install @modelcontextprotocol/sdk zod
```

### 2. Create tool definitions

One file per domain (projects, apps, events, metrics, funnels, integrations,
jobs, audit-logs). Each file exports a function that registers tools on an
`McpServer` instance:

```
apps/server/src/mcp/
├── index.ts              # Fastify route + server factory
├── tools/
│   ├── projects.ts
│   ├── apps.ts
│   ├── events.ts
│   ├── metrics.ts
│   ├── funnels.ts
│   ├── integrations.ts
│   ├── jobs.ts
│   └── audit-logs.ts
└── auth.ts               # Extract + validate owl_agent_* key
```

### 3. Wire into Fastify

Register a single route at `/mcp` that:
1. Extracts the bearer token from the Authorization header
2. Validates it against the existing auth logic
3. Creates a stateless McpServer with all tools registered
4. Passes the auth context into each tool handler
5. Delegates to `StreamableHTTPServerTransport.handleRequest()`

### 4. Tool handlers call existing service logic

Tool handlers should call the same service/repository functions that the REST
routes already use — not make HTTP requests to themselves. This keeps it fast
and avoids circular dependencies.

---

## Estimated Scope

| Component | Files | Complexity |
|---|---|---|
| Fastify route + MCP bootstrap | 1–2 files | Low |
| Tool definitions (8 domains, ~30 tools) | 8 files | Medium (repetitive) |
| Auth middleware | 1 file | Low |
| Zod schemas for tool inputs | Inline in tool files | Low |
| Tests | 1–2 files | Medium |

The bulk of the work is defining ~30 tools with Zod schemas and wiring them to
existing service functions. Each tool is ~15–30 lines. The MCP protocol
handling is entirely managed by the SDK.

## Key Decisions to Make

1. **Stateless vs stateful** — Stateless is simpler and recommended unless you
   need server-initiated notifications.
2. **JSON response vs SSE** — `enableJsonResponse: true` is simpler. SSE only
   needed for streaming long-running operations (e.g., job progress).
3. **Service layer refactoring** — If route handlers currently contain business
   logic inline, it may need extracting into shared service functions that both
   routes and MCP tools can call.
4. **Versioning** — MCP tools don't have explicit versioning. Adding/removing
   tools is a breaking change for clients. Consider a capability negotiation
   pattern if needed.
