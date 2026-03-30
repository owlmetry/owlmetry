export const GUIDE_CONTENT = `# OwlMetry — Agent Guide

OwlMetry is a self-hosted analytics platform for mobile and backend apps. It captures events, structured metrics, and funnel conversions from client SDKs (Swift, Node.js), stores them in a partitioned PostgreSQL database, and exposes query and management APIs.

You are connected via MCP using an **agent key** (\`owl_agent_...\`). Agent keys are for reading data and managing resources. **Client keys** (\`owl_client_...\`) are used by SDKs for event ingestion — you will not ingest events yourself, but you will retrieve client keys when creating apps for SDK configuration.

## Resource Hierarchy

OwlMetry organises resources in a **Team → Project → Apps** hierarchy:

- **Team** — the top-level account. All resources (projects, apps, keys) are team-scoped. Use \`whoami\` to see your team and permissions.
- **Project** — groups related apps under one product (e.g., "MyApp" project). Metrics and funnels are defined at the project level so they span all apps in the project. Each project has configurable data retention policies for events (default: 120 days), metrics (default: 365 days), and funnels (default: 365 days).
- **App** — represents a single deployable artifact. Each app has a \`platform\` (\`apple\`, \`android\`, \`web\`, \`backend\`) and, for non-backend platforms, a \`bundle_id\`. Creating an app auto-generates a \`client_secret\` for SDK use.

Projects group apps cross-platform: an iOS app and its backend API can share the same project, enabling unified funnel and metric analysis across both.

## Discovering IDs

Start with \`whoami\` to see your team, then drill down:

- **Team ID**: \`whoami\` → \`teams[].id\`
- **Project ID**: \`list-projects\` → \`projects[].id\`
- **App ID**: \`list-apps\` → \`apps[].id\` (also returns \`client_secret\`)
- **Metric/Funnel slug**: \`list-metrics\` / \`list-funnels\` → \`[].slug\`

All list tools support an optional \`team_id\` parameter to scope results.

## Concepts

### Events
Events are raw log records emitted by SDKs — every \`Owl.info()\`, \`Owl.error()\`, \`Owl.track()\`, etc. Each event has:
- **level**: \`info\`, \`debug\`, \`warn\`, \`error\`
- **message**: the log message or event name
- **session_id**: unique per SDK \`configure()\` call, groups events in a session
- **user_id**: optional, set via identity claim
- **screen_name**: optional, from SDK screen tracking
- **environment**: the runtime — \`ios\`, \`ipados\`, \`macos\`, \`android\`, \`web\`, \`backend\`
- **custom_attributes**: freeform JSONB data
- **experiments**: A/B variant assignments active at the time

Query events when debugging specific issues, investigating user behavior, or reviewing what happened in a time window. Default range is last 24 hours.

### Structured Metrics
Metrics are project-scoped definitions that tell OwlMetry what structured data to expect. Two kinds:

- **Lifecycle metrics**: track operations with a start → complete/fail/cancel flow. Use for things with duration — API calls, uploads, database queries. The SDK auto-tracks \`duration_ms\`. Phases: \`start\`, \`complete\`, \`fail\`, \`cancel\`.
- **Single-shot metrics** (\`record\` phase): record a point-in-time measurement. Use for snapshots — cache hit rates, queue depth, cold start time.

The metric definition must exist on the server **before** the SDK emits events for that slug. Create definitions with \`create-metric\`.

Aggregation queries (\`query-metric\`) return: total count, counts per phase, success rate, duration percentiles (avg, p50, p95, p99), unique users, and error breakdown. Results can be grouped by app, version, environment, device, OS, or time bucket.

Metric slugs: lowercase letters, numbers, hyphens only (\`/^[a-z0-9-]+$/\`).

### Funnels
Funnels measure how users progress through a multi-step flow and where they drop off. Each funnel has ordered steps with an \`event_filter\` matching on \`step_name\` and/or \`screen_name\`.

The \`step_name\` in the filter matches what developers pass to \`Owl.track("step-name")\` — no prefix transformation needed.

Two analysis modes:
- **Open mode** (default): independent — each step counts distinct users separately, regardless of other steps. Good for non-linear flows.
- **Closed mode** (\`mode: "closed"\`): sequential — users must complete steps in order with strict timestamp ordering per \`user_id\`. Events with no \`user_id\` are excluded. Good for linear flows like checkout.

Maximum 20 steps per funnel. Funnel slugs follow the same rules as metric slugs.

### Data Modes
The \`data_mode\` parameter filters development vs production events:
- \`production\` (default) — real user data only
- \`development\` — test/debug data only (SDKs auto-detect: DEBUG builds on iOS, \`NODE_ENV !== "production"\` on Node)
- \`all\` — both

Available on: \`query-events\`, \`query-metric\`, \`list-metric-events\`, \`query-funnel\`.

### Time Formats
All time parameters (\`since\`, \`until\`) accept:
- **Relative durations**: \`30s\`, \`30m\`, \`1h\`, \`7d\`, \`1w\` (backwards from now)
- **ISO 8601 dates**: \`2025-01-15T10:00:00Z\`

Default ranges: events = 24 hours, funnels = 30 days, metrics = 24 hours.

### A/B Experiments
SDKs support client-side experiment assignment. All events include an \`experiments\` field (JSONB, \`Record<string, string>\`) with current variant assignments.

Funnel queries can:
- **Filter** by experiment variant: \`experiment: "onboarding-test:control"\`
- **Segment** by variant: \`group_by: "experiment:onboarding-test"\`

### User Properties
Custom key-value properties stored on app users. Set via SDK (\`setUserProperties()\`) or synced from integrations (e.g., RevenueCat). Properties are shallow-merged on update; empty string values delete keys. Limits: 50 keys max, 50-char keys, 200-char values.

### Integrations
Third-party service connections (e.g., RevenueCat) that sync data into user properties. Configured per-project.

Setting up RevenueCat:
1. Generate a **V2 Secret API key** in RevenueCat (Project Settings → API Keys → + New secret API key). Required permissions: **Customer information → Customers Configuration → Read only**. All other sections → No access.
2. Call \`add-integration\` with the API key. A webhook secret is auto-generated if you don't provide one. The response includes a \`webhook_setup\` section with the exact values to paste into RevenueCat's webhook settings (URL, authorization header, environment, events filter).
3. Configure the webhook in RevenueCat (Settings → Webhooks → + New Webhook) using the values from \`webhook_setup\`.
4. Run \`sync-integration\` to backfill existing subscriber data.

### Background Jobs
Asynchronous server-side tasks with progress tracking and optional email notifications. Used for long-running operations like bulk syncs. Only one instance of each job type (per project) can run at a time — duplicates return an error.

### Audit Trail
Every mutation (create, update, delete) on resources is recorded in audit logs with the actor, action, resource type, resource ID, and metadata. Query with \`list-audit-logs\`.

## Tool Reference

### Auth
- \`whoami\` — Check identity, team, and permissions

### Projects
- \`list-projects\` — List all projects (optional \`team_id\` filter)
- \`get-project\` — Get project by ID with nested apps and retention policies
- \`create-project\` — Create project (needs \`projects:write\`): \`team_id\`, \`name\`, \`slug\`, optional \`retention_days_events\`, \`retention_days_metrics\`, \`retention_days_funnels\`
- \`update-project\` — Update project name or retention policies (needs \`projects:write\`). Set retention to \`null\` to reset to defaults.

### Apps
- \`list-apps\` — List all apps (optional \`team_id\` filter)
- \`get-app\` — Get app by ID (includes \`client_secret\`)
- \`create-app\` — Create app (needs \`apps:write\`): \`name\`, \`platform\`, \`project_id\`, optional \`bundle_id\`
  - Platforms: \`apple\`, \`android\`, \`web\`, \`backend\`
  - \`bundle_id\` required for non-backend, immutable after creation
  - Returns \`client_secret\` for SDK configuration
- \`update-app\` — Update app name (needs \`apps:write\`)
- \`list-app-users\` — List users for an app (search, anonymous filter, pagination)

### Events
- \`query-events\` — Filter by project, app, level, user, session, environment, screen, time, data mode. Cursor pagination.
- \`get-event\` — Get full event details by ID
- \`investigate-event\` — Get target event + surrounding context events from same app/user within a time window (default 5 min)

### Metrics
- \`list-metrics\` — List definitions for a project
- \`get-metric\` — Get definition by slug
- \`create-metric\` — Create definition (needs \`metrics:write\`): \`project_id\`, \`name\`, \`slug\`
- \`update-metric\` — Update definition (needs \`metrics:write\`)
- \`delete-metric\` — Soft-delete (needs \`metrics:write\`)
- \`query-metric\` — Aggregated stats with optional grouping
- \`list-metric-events\` — Raw metric events with phase/tracking_id filters

### Funnels
- \`list-funnels\` — List definitions for a project
- \`get-funnel\` — Get definition by slug with steps
- \`create-funnel\` — Create with ordered steps (needs \`funnels:write\`): \`project_id\`, \`name\`, \`slug\`, \`steps\`
- \`update-funnel\` — Update name, description, or steps (needs \`funnels:write\`)
- \`delete-funnel\` — Soft-delete (needs \`funnels:write\`)
- \`query-funnel\` — Conversion analytics with mode (open/closed) and grouping

### Integrations
- \`list-providers\` — Supported providers and config fields
- \`list-integrations\` — Configured integrations for a project
- \`add-integration\` — Add integration (needs \`integrations:write\`): \`project_id\`, \`provider\`, \`config\`
- \`update-integration\` — Update config or enabled state (needs \`integrations:write\`)
- \`remove-integration\` — Remove (needs \`integrations:write\`)
- \`sync-integration\` — Trigger sync: bulk (omit \`user_id\`, queues job) or single user (with \`user_id\`, synchronous)

### Jobs
- \`list-jobs\` — List job runs for a team (filter by type, status, project, date)
- \`get-job\` — Get job details with progress
- \`trigger-job\` — Trigger a job (needs \`jobs:write\`): \`team_id\`, \`job_type\`, optional \`project_id\`, \`params\`, \`notify\`
- \`cancel-job\` — Cancel a running job (cooperative cancellation)

### Audit Logs
- \`list-audit-logs\` — Query audit trail (needs \`audit_logs:read\`): filter by resource_type, actor, action, date

## Permissions

Your agent key has specific permissions. Common permission sets:

| Permission | Grants |
|---|---|
| \`events:read\` | query-events, get-event, investigate-event |
| \`projects:read\` | list-projects, get-project |
| \`projects:write\` | create-project, update-project |
| \`apps:read\` | list-apps, get-app, list-app-users |
| \`apps:write\` | create-app, update-app |
| \`metrics:read\` | list-metrics, get-metric, query-metric, list-metric-events |
| \`metrics:write\` | create-metric, update-metric, delete-metric |
| \`funnels:read\` | list-funnels, get-funnel, query-funnel |
| \`funnels:write\` | create-funnel, update-funnel, delete-funnel |
| \`integrations:read\` | list-providers, list-integrations |
| \`integrations:write\` | add-integration, update-integration, remove-integration, sync-integration |
| \`jobs:read\` | list-jobs, get-job |
| \`jobs:write\` | trigger-job, cancel-job |
| \`audit_logs:read\` | list-audit-logs |
| \`users:write\` | Set user properties |

If a tool returns a permissions error, the agent key is missing the required permission.

## Typical Workflows

### Setting up a new project
1. \`whoami\` → get team ID and verify permissions
2. \`create-project\` → create project with name and slug (optionally set retention policies)
3. \`create-app\` → create app(s) for each platform, note the \`client_secret\`
4. Read the SDK integration guide for the platform — see **SDK Integration Guides** below
5. Configure the SDK with the \`client_secret\` and ingest endpoint

### Defining what to track
1. \`create-metric\` → for each measurable operation (API calls, load times, etc.)
2. \`create-funnel\` → for each user flow (onboarding, checkout, etc.)
3. Instrument the SDK code with the corresponding metric slugs and step names — see the SDK guides for API details

### Querying and analysis
1. \`query-events\` → search for specific events, errors, or user activity
2. \`investigate-event\` → get context around a specific event (flight recorder)
3. \`query-metric\` → aggregated performance stats with grouping
4. \`list-metric-events\` → drill into individual metric events
5. \`query-funnel\` → conversion rates and drop-off analysis

### Connecting integrations
1. \`list-providers\` → see available providers and config fields
2. \`add-integration\` → configure the integration
3. \`sync-integration\` → backfill existing data (triggers background job)
4. \`get-job\` → monitor sync progress

## SDK Integration Guides

This MCP server provides SDK integration guides as resources. Read the relevant guide when you need to install, configure, or instrument an SDK in the user's codebase.

| Resource | SDK | Use when |
|---|---|---|
| \`owlmetry://skills/swift\` | Swift SDK | Instrumenting iOS, iPadOS, or macOS apps (SwiftUI or UIKit) |
| \`owlmetry://skills/node\` | Node.js SDK | Instrumenting backend services (Express, Fastify, serverless, etc.) |

Each guide covers: package installation, \`configure()\` setup, event logging, screen tracking (Swift), structured metrics, funnel tracking, A/B experiments, user identity, and user properties.

**Note:** The guides reference CLI commands for creating metrics and funnels. You can use the equivalent MCP tools instead (\`create-metric\`, \`create-funnel\`).

## Key Notes

- \`bundle_id\` is **immutable after creation** — to change it, delete and recreate the app. Backend apps have no bundle_id.
- Agent keys are for reading/managing. Client keys are for SDK event ingestion.
- Metric and funnel definitions must exist on the server before the SDK emits events for that slug.
- Cursor-based pagination: use the \`cursor\` from the response to fetch the next page. \`has_more\` indicates more results.
- All write tools that modify resources are recorded in the audit log.
- Soft-deleted resources can be restored by creating a new resource with the same slug.
`;
