export const GUIDE_CONTENT = `# OwlMetry — Agent Guide

OwlMetry is a self-hosted analytics platform for mobile and backend apps. It captures events, structured metrics, and funnel conversions from client SDKs (Swift, Node.js), stores them in a partitioned PostgreSQL database, and exposes query and management APIs.

You are connected via MCP using an **agent key** (\`owl_agent_...\`). Agent keys are for reading data and managing resources. **Client keys** (\`owl_client_...\`) are used by SDKs for event ingestion — you will not ingest events yourself, but you will retrieve client keys when creating apps for SDK configuration.

## Resource Hierarchy

OwlMetry organises resources in a **Team → Project → Apps** hierarchy:

- **Team** — the top-level account. All resources (projects, apps, keys) are team-scoped. Use \`whoami\` to see your team.
- **Project** — groups related apps under one product (e.g., "MyApp" project). Metrics and funnels are defined at the project level so they span all apps in the project.
- **App** — represents a single deployable artifact. Each app has a \`platform\` (\`apple\`, \`android\`, \`web\`, \`backend\`) and, for non-backend platforms, a \`bundle_id\`. Creating an app auto-generates a \`client_key\` for SDK use.

Projects group apps cross-platform: an iOS app and its backend API can share the same project, enabling unified funnel and metric analysis across both.

## Discovering IDs

- **Team ID**: \`whoami\` → \`teams[].id\`
- **Project ID**: \`list-projects\` → \`projects[].id\`
- **App ID**: \`list-apps\` → \`apps[].id\` (also returns \`client_key\`)

## Concepts

### Events
Events are raw log records emitted by SDKs — every \`Owl.info()\`, \`Owl.error()\`, \`Owl.track()\`, etc. Query events when debugging specific issues, investigating user behavior, or reviewing what happened in a time window. Levels: \`info\`, \`debug\`, \`warn\`, \`error\`.

### Structured Metrics
Metrics are project-scoped definitions that tell OwlMetry what structured data to expect. Two kinds:
- **Lifecycle metrics**: track operations with a start → complete/fail/cancel flow. Use for things with duration — API calls, uploads, database queries. The SDK auto-tracks \`duration_ms\`.
- **Single-shot metrics**: record a point-in-time measurement. Use for snapshots — cache hit rates, queue depth, cold start time.

The metric definition must exist on the server **before** the SDK emits events for that slug.

Metric slugs: lowercase letters, numbers, hyphens only (\`/^[a-z0-9-]+$/\`).

### Funnels
Funnels measure how users progress through a multi-step flow and where they drop off. Each funnel has ordered steps with an \`event_filter\` matching on \`step_name\` and/or \`screen_name\`. The \`step_name\` in the filter matches what developers pass to \`Owl.track("step-name")\`.

Two analysis modes:
- **Open mode** (default): independent — each step counts distinct users separately, regardless of other steps.
- **Closed mode**: sequential — users must complete steps in order with strict timestamp ordering. Events with no \`user_id\` are excluded.

Maximum 20 steps per funnel. Funnel slugs follow the same rules as metric slugs.

### Data Modes
- \`production\` (default) — real user data only
- \`development\` — test/debug data only (SDKs auto-detect: DEBUG builds on iOS, \`NODE_ENV !== "production"\` on Node)
- \`all\` — both

### Time Formats
All time parameters accept:
- Relative durations: \`1h\`, \`30m\`, \`7d\`, \`1w\`, \`30s\` (backwards from now)
- ISO 8601 dates: \`2026-03-20T00:00:00Z\`

### A/B Experiments
SDKs support client-side experiment assignment. All events include an \`experiments\` field with current assignments. Funnel queries can filter by experiment variant (\`experiment=name:variant\`) or segment by variant (\`group_by=experiment:name\`).

### Integrations
Third-party service connections (e.g., RevenueCat) that sync data into user properties. Configured per-project. After adding, configure webhooks in the provider's dashboard and run a bulk sync to backfill.

### Background Jobs
Asynchronous server-side tasks with progress tracking. Used for long-running operations like bulk syncs. Only one instance of each job type (per project) can run at a time.

## Typical Workflow

1. **Check identity**: \`whoami\` → see team, permissions
2. **List projects**: \`list-projects\` → find existing or create new
3. **Create apps**: \`create-app\` with platform + bundle_id → note the \`client_key\` for SDK config
4. **Define metrics**: \`create-metric\` for each metric slug the SDK will emit
5. **Define funnels**: \`create-funnel\` with ordered steps
6. **Query data**: \`query-events\`, \`query-metric\`, \`query-funnel\` to analyze behavior
7. **Investigate issues**: \`investigate-event\` for contextual debugging around a specific event

## Key Notes

- \`bundle_id\` is **immutable after creation** — to change it, delete and recreate the app. Backend apps have no bundle_id.
- Agent keys are for reading/managing. Client keys are for SDK event ingestion.
- Metric/funnel definitions must exist before the SDK emits events for that slug.
- All list endpoints support optional \`team_id\` to scope results.
- Events default to last 24 hours. Funnels default to last 30 days.
- Cursor-based pagination: use the \`cursor\` from the response to fetch the next page.
`;
