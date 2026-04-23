export const GUIDE_CONTENT = `# OwlMetry — Agent Guide

OwlMetry is a self-hosted analytics platform for mobile and backend apps. It captures events, structured metrics, and funnel conversions from client SDKs (Swift, Node.js), stores them in a partitioned PostgreSQL database, and exposes query and management APIs.

You are connected via MCP using an **agent key** (\`owl_agent_...\`). Agent keys are for reading data and managing resources. **Client keys** (\`owl_client_...\`) are used by SDKs for event ingestion — you will not ingest events yourself, but you will retrieve client keys when creating apps for SDK configuration. **Import keys** (\`owl_import_...\`) are for bulk-importing historical event data — you can create these with the \`create-import-key\` tool.

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
Events are raw log records emitted by SDKs — every \`Owl.info()\`, \`Owl.error()\`, \`Owl.step()\`, etc. Each event has:
- **level**: \`info\`, \`debug\`, \`warn\`, \`error\`
- **message**: the log message or event name
- **session_id**: unique per SDK \`configure()\` call, groups events in a session. See **Cross-SDK Session Correlation** below for the iOS-to-Node pattern.
- **user_id**: optional, set via identity claim
- **screen_name**: optional, from SDK screen tracking
- **environment**: the runtime — \`ios\`, \`ipados\`, \`macos\`, \`android\`, \`web\`, \`backend\`
- **custom_attributes**: freeform JSONB data
- **experiments**: A/B variant assignments active at the time

Query events when debugging specific issues, investigating user behavior, or reviewing what happened in a time window. Default range is last 24 hours.

### Cross-SDK Session Correlation

Every SDK emits events under a \`session_id\`. By default the Node SDK's session is **per-process** — shared across every request the process handles — which is almost never what you want for a multi-client backend. To make client and backend events show up together under one session, forward the client's session id with each request.

The pattern (iOS → Node):

1. **Client (Swift)**: read \`Owl.sessionId\` and attach it to outgoing requests as an \`X-Owl-Session-Id\` header.
2. **Backend (Node)**: pull the header off the request and either wrap the handler in \`Owl.withSession(sessionId)\` (all events inside that scope pick it up) or pass \`{ sessionId }\` to each individual log call.

**Precedence**: per-call \`options.sessionId\` > \`withSession(...)\` scope > default session from \`configure()\`. Non-UUID values are silently ignored, so it is safe to forward the header unconditionally.

Result: one logical user interaction (tap → API call → DB query → response → UI update) lands under a single \`session_id\`. \`investigate-event\` and \`query-events\` with \`session_id\` filters then return the full cross-app timeline automatically. Wire this up on any project that has both a Swift app and a Node backend in the same project — it is the whole point of grouping them under one project.

Full setup snippets (Fastify/Express hook + Swift \`URLSession\` interceptor): \`owlmetry://skills/node\` → "Per-Request Session Scoping".

### Structured Metrics
Metrics are project-scoped definitions that tell OwlMetry what structured data to expect. Two kinds:

- **Lifecycle metrics**: track operations with a start → complete/fail/cancel flow. Use for things with duration — API calls, uploads, database queries. The SDK auto-tracks \`duration_ms\`. Phases: \`start\`, \`complete\`, \`fail\`, \`cancel\`.
- **Single-shot metrics** (\`record\` phase): record a point-in-time measurement. Use for snapshots — cache hit rates, queue depth, cold start time.

The metric definition must exist on the server **before** the SDK emits events for that slug. Create definitions with \`create-metric\`.

Aggregation queries (\`query-metric\`) return: total count, counts per phase, success rate, duration percentiles (avg, p50, p95, p99), unique users, and error breakdown. Results can be grouped by app, version, environment, device, OS, or time bucket.

Metric slugs: lowercase letters, numbers, hyphens only (\`/^[a-z0-9-]+$/\`).

### Funnels
Funnels measure how users progress through a multi-step flow and where they drop off. Each funnel has ordered steps with an \`event_filter\` matching on \`step_name\` and/or \`screen_name\`.

The \`step_name\` in the filter matches what developers pass to \`Owl.step("step-name")\` — no prefix transformation needed.

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
Custom key-value properties stored on project-level users. Users are unique per project, not per app — the same user ID seen from multiple apps (e.g., iOS + backend) is a single user. Each user tracks which apps they've been seen from. Properties are set via SDK (\`setUserProperties()\`) or synced from integrations (e.g., RevenueCat). Properties are shallow-merged on update; empty string values delete keys. Limits: 50 keys max, 50-char keys, 200-char values.

### Integrations
Third-party service connections (RevenueCat, Apple Search Ads) that sync data into user properties. Configured per-project.

**Setting up RevenueCat — the only thing you need from the user is their RevenueCat V2 Secret API key.** Everything else is automatic.

1. Ask the user for their **RevenueCat V2 Secret API key**. They generate it in RevenueCat dashboard → Project Settings → API Keys → + New secret API key. Required permissions (set at the section level using the top-right dropdown on each section, not individual sub-rows): **Customer information → Read only** AND **Project configuration → Read only**. All other sections → No access.
2. Call \`add-integration\` with just \`api_key\`. Do NOT ask the user for a webhook secret — one is auto-generated.
3. The response includes a \`webhook_setup\` section with every value the user needs to paste into RevenueCat's webhook form (Settings → Webhooks → + New Webhook): webhook URL, authorization header (contains the auto-generated secret), environment, and events filter. Present these to the user.
4. After the user confirms the webhook is saved, run \`sync-integration\` to backfill existing subscriber data.

**Setting up Apple Search Ads — needed to resolve captured ASA IDs into human-readable names** (campaign name, ad group name, keyword text, ad name). Complementary to RevenueCat: ASA covers every attributed user, RC only subscribers.

**IMPORTANT: DO NOT ask the user for a private key or an openssl command.** OwlMetry generates the EC P-256 keypair server-side. The flow is three calls:

1. Call \`add-integration\` with \`provider: "apple-search-ads"\` and an empty config (\`{}\`). The response includes the generated \`public_key_pem\` under \`config.public_key_pem\` and an instructions block. Relay the public key to the user.
2. Walk the user through uploading it at ads.apple.com:
   - Account Settings → User Management → Invite (or reuse) an API user with role \`API Account Read Only\`.
   - On that user's API tab, paste the public key from step 1. Apple returns \`clientId\`, \`teamId\`, \`keyId\`.
3. Call \`update-integration\` with \`provider: "apple-search-ads"\` and \`config: { client_id, team_id, key_id }\`. The integration is still pending at this point.
4. Call \`update-integration\` again with \`config: { org_id }\` (the numeric "Account ID" shown in the ads.apple.com profile menu top-right). The integration auto-enables when all four IDs are present — do NOT pass \`enabled\`.
5. (Optional) Call \`sync-integration\` with \`provider: "apple-search-ads"\` to backfill names for users attributed before the integration was connected. New attributions enrich automatically via a fire-and-forget hook in the attribution route.

The server strips \`private_key_pem\` and \`public_key_pem\` from any user-supplied config on POST/PATCH — it only generates them itself. If the user asks to rotate the keypair, remove the integration and re-add (which creates a new keypair; they'll need to upload the new public key to Apple).

### Attribution

Where a user came from, stored as user properties on \`app_users\`. Today only **Apple Search Ads** is implemented — future Meta / Google Ads support will write into the same keys.

**Auto-captured by the Swift SDK** on \`Owl.configure()\` (iOS / iPadOS / macOS). No code required. The SDK fetches the AdServices attribution token, posts it to OwlMetry, and writes the resolved attribution onto the user's properties.

User properties written:
- \`attribution_source\` — \`apple_search_ads\` on a successful attribution, \`none\` when the install came from organic / another source. Query/group on this key rather than a network-specific flag; future networks will reuse it.
- On successful ASA attribution, additional ASA-specific IDs are written: \`asa_campaign_id\`, \`asa_ad_group_id\`, \`asa_keyword_id\`, \`asa_claim_type\`, \`asa_ad_id\`, \`asa_creative_set_id\`. Human-readable names (campaign name, keyword text, etc.) are resolved into extra properties when the Apple Search Ads integration is configured for the project (see **Integrations** above).
- \`likely_app_reviewer = "true"\` when Apple returns its App Store review sandbox fixture (same numeric ID across campaign, ad group, and ad). Traceable numeric IDs are still stored, but exclude these users when reporting on paid acquisition.

**Opt out**: pass \`attributionEnabled: false\` to \`Owl.configure()\` on the Swift SDK. Full setup, opt-out, and manual-submit APIs: \`owlmetry://skills/swift\` → "Apple Search Ads Attribution".

**RevenueCat backfill**: when the RevenueCat integration is enabled, \`sync-integration\` (or per-user sync on webhook events) also pulls ASA attribution out of RevenueCat's subscriber attributes and writes the same properties. This is how users who onboarded **before** the app shipped SDK-side attribution capture get attributed — no extra setup, happens automatically during any RevenueCat sync.

**Debugging "none"**: the SDK emits \`sdk:attribution_capture\` events for each capture attempt with outcomes (\`success\`, \`pending\`, \`gave_up\`, \`token_fetch_failed\`, \`invalid_token\`, \`transport_failure\`). When a specific install shows \`attribution_source = "none"\` and you need to know why, \`query-events\` with \`message: "sdk:attribution_capture"\` and the user's \`user_id\` (or their session) will show the outcome and retry history.

### Issues
Error events are automatically scanned hourly and grouped into **issues** via fingerprinting (normalized error message + source module). Each issue tracks:
- **Occurrences**: one per unique session. Each occurrence records the \`session_id\`, \`user_id\`, \`event_id\`, \`app_version\`, and \`environment\` — use these to drill into what happened.
- **Unique users**: how many distinct users are affected (severity indicator)
- **Status lifecycle**: \`new\` → \`in_progress\` (claimed by agent/user) → \`resolved\` (optionally with app version) → may \`regress\` if the error reappears in a newer version. Issues can also be \`silenced\` to suppress notifications while still tracking occurrences.
- **Comments**: investigation notes from users (\`👤\`) and agents (\`🕶️\`). Markdown supported.
- **Merge**: if two issues turn out to be the same problem, merge them — all fingerprints, occurrences, and comments move to the target.
- **Notifications**: per-project configurable email digest (none/hourly/6-hourly/daily/weekly). Only non-dev, new/regressed issues with activity since last notification are included.

Dev events (\`is_dev = true\`) create separate issues — they are tracked but never trigger notifications.

#### Investigating an issue

To fully investigate an issue, follow this workflow:

1. **Find the issue**: \`list-issues\` with \`project_id\` to see open issues sorted by severity (unique users affected). Filter by \`status: "new"\` to focus on uninvestigated issues.
2. **Claim it**: \`claim-issue\` to set status to \`in_progress\`, signaling that you're investigating.
3. **Read the detail**: \`get-issue\` returns the issue with its \`occurrences\` array. Each occurrence represents a unique session where the error happened and includes:
   - \`session_id\` — the session where the error occurred
   - \`user_id\` — the affected user (null if anonymous)
   - \`event_id\` — the specific error event
   - \`app_version\` / \`environment\` — which build and platform
   - \`timestamp\` — when it happened
4. **Reconstruct breadcrumbs**: Pick an occurrence and use \`investigate-event\` with the \`event_id\` to get the best timeline we can build — the full session (or a ±5 min window for events without a session_id), enriched with cross-app events (e.g. backend) for the same user in the same project. Results come merged, deduped, and sorted ascending by timestamp. Pass \`compact: true\` to drop verbose fields (custom_attributes, experiments, device metadata) and avoid MCP token overflow on long timelines.
5. **Read the error event**: Use \`get-event\` with the occurrence's \`event_id\` to see the full error details including \`custom_attributes\` (stack traces, error codes, etc.).
6. **Check multiple occurrences**: Repeat steps 4-5 for other occurrences to see if the error has a common pattern (same screen, same version, same user flow).
7. **Document findings**: \`add-issue-comment\` to record what you found — root cause, affected versions, reproduction steps, or a fix plan. This is visible to the team.
8. **Resolve or escalate**: \`resolve-issue\` with the fix version once patched, or leave the comment for the team to act on.

### Feedback
Free-text user feedback. Two ingest paths: mobile apps via the Swift SDK (\`OwlFeedbackView\` / \`Owl.sendFeedback\`), and server handlers via the Node SDK (\`Owl.sendFeedback\`) — use the Node path when a team collects feedback through their own frontend (form, chat widget, support page) and wants it forwarded into OwlMetry. Each feedback row captures \`message\`, optional \`submitter_name\` and \`submitter_email\`, plus the session, user, app version, device, environment, and country — automatically on mobile, caller-supplied on Node.

- **Status lifecycle** — free transitions between \`new\`, \`in_review\`, \`addressed\`, \`dismissed\`. No forced order; \`dismissed\` is the "not actionable" state.
- **Comments** — investigation notes from users (\`👤\`) and agents (\`🕶️\`), mirror the issue-comment model.
- **Session link** — \`session_id\` on the feedback row maps to the full event stream; pass it to \`investigate-event\` with any event from that session to reconstruct the breadcrumb timeline around the complaint.
- **Delete** — user-only. MCP cannot delete feedback by design: use \`update-feedback-status → dismissed\` for "not actionable" instead.

Typical workflow: \`list-feedback\` filtered to \`status: "new"\` → \`get-feedback\` to read the message and linked session → \`investigate-event\` on an event from that session to understand what the user was doing → \`add-feedback-comment\` with root cause or a cross-link to a related issue → \`update-feedback-status\` to \`in_review\` or \`addressed\`.

### Event Attachments (limited resource)
SDKs can optionally upload a file alongside an error event (e.g. the input image that failed to convert, a 3D model file that failed to parse). These show up as \`attachments\` on \`get-event\` and \`get-issue\` responses and can be downloaded via \`get-attachment\` which returns a short-lived signed URL.

**Attachments are a limited, finite resource.** Each project has a storage quota (default 5 GB) and each end-user has their own bucket within that project (default 250 MB per user). Uploads that would exceed the per-user bucket are rejected with \`413 user_quota_exhausted\`; ones that would exceed the project ceiling return \`413 quota_exhausted\`. Either way the event still posts, but the attachment does not. Before asking a user to re-run a scenario with a file attached, call \`get-project-attachment-usage\` (optionally with that user's \`user_id\`) so you know whether there's headroom.

**When attachments help investigations**:
- A media-conversion error where the input bytes are needed to reproduce the bug.
- A model-load failure where the file format itself is the suspect.
- A parse error on a file whose bytes you cannot reconstruct from event attributes alone.

**When they don't**:
- Routine errors whose root cause is obvious from the message or stack trace.
- Data you can already reconstruct from \`custom_attributes\` or breadcrumbs.
- Frequent/high-volume errors — the quota will fill almost immediately.

Attachments linked to an event are automatically linked to its issue by the issue-scan job. They survive event retention pruning as long as the issue is still open, and are hard-deleted 7 days after the issue (or the attachment itself) is soft-deleted. Use \`delete-attachment\` once an issue is confirmed resolved and the file is no longer useful.

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
  - **Naming (strict)**: project names MUST be the bare product name only — e.g. "Lofi". Never include a platform suffix ("Lofi iOS", "Lofi Backend") on the project itself; suffixes belong on apps within the project.
- \`update-project\` — Update project name, display color, or retention policies (needs \`projects:write\`). Set retention to \`null\` to reset to defaults. \`color\` is \`#RRGGBB\` hex — auto-assigned on create, overridable here.

### Apps
- \`list-apps\` — List all apps (optional \`team_id\` filter)
- \`get-app\` — Get app by ID (includes \`client_secret\`)
- \`create-app\` — Create app (needs \`apps:write\`): \`name\`, \`platform\`, \`project_id\`, optional \`bundle_id\`
  - Platforms: \`apple\`, \`android\`, \`web\`, \`backend\`
  - \`bundle_id\` required for non-backend, immutable after creation
  - Returns \`client_secret\` for SDK configuration
  - **Naming (strict)**: app names MUST always be \`<project name> <platform>\` — e.g. "Lofi iOS", "Lofi Android", "Lofi Web", "Lofi Backend". Never omit the platform suffix, even if the project name seems to imply a platform.
- \`update-app\` — Update app name (needs \`apps:write\`)
- \`list-app-users\` — List users for an app (search, anonymous filter, billing tier filter, pagination)

### Events
- \`query-events\` — Filter by project, app, level, user, session, environment, screen, time, data mode. Cursor pagination. Pass \`session_id\` to reconstruct a session timeline (preferred for issue drill-down). Pass \`order: "asc"\` to walk events chronologically (default \`desc\`/newest-first) — use ascending for session timelines and breadcrumb investigations. Pass \`compact: true\` to drop verbose fields.
- \`get-event\` — Get full event details by ID
- \`investigate-event\` — Best breadcrumb trail for an event. Pulls the full session (or ±window_minutes if no session_id), then enriches with cross-app events for the same user in the same project. Returns a single chronological \`events\` array with \`target_event_id\`. Prefer this over \`query-events\` when drilling into a specific event. Supports \`compact: true\`.

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

### Issues
- \`list-issues\` — List issues for a project (filter by status, app, dev/prod)
- \`get-issue\` — Get issue detail with occurrences, comments, fingerprints, and linked attachments
- \`resolve-issue\` — Mark resolved, optionally with the fix version
- \`silence-issue\` — Silence notifications (still tracks occurrences)
- \`reopen-issue\` — Reopen a resolved or silenced issue
- \`claim-issue\` — Set status to in_progress (claim for investigation)
- \`merge-issues\` — Merge source issue into target (moves all data, deletes source)
- \`list-issue-comments\` — List investigation comments on an issue
- \`add-issue-comment\` — Add a comment to document findings or fixes

### Feedback
- \`list-feedback\` — List user feedback for a project (filter by status, app, dev/prod)
- \`get-feedback\` — Get feedback detail with comments
- \`update-feedback-status\` — Transition status (\`new\` | \`in_review\` | \`addressed\` | \`dismissed\`)
- \`add-feedback-comment\` — Attach an investigation note or cross-link

### Attachments
- \`list-attachments\` — filter by event, issue, or project
- \`get-attachment\` — metadata + 60-second signed download URL
- \`delete-attachment\` — soft-delete once no longer useful (frees quota)
- \`get-project-attachment-usage\` — check quota headroom before recommending re-runs

### Integrations
- \`list-providers\` — Supported providers and config fields
- \`list-integrations\` — Configured integrations for a project
- \`add-integration\` — Add integration (needs \`integrations:write\`): \`project_id\`, \`provider\`, \`config\`
- \`update-integration\` — Update config or enabled state (needs \`integrations:write\`)
- \`remove-integration\` — Remove (needs \`integrations:write\`)
- \`copy-integration\` — One-step clone of a configured integration to another project in the same team (needs \`integrations:write\`, admin role). **Apple Search Ads**: full config (keypair + client/team/key/org IDs) is duplicated verbatim, target enables immediately, and the response includes a \`connection_test\` field from a live Apple \`/acls\` call confirming the clone works end-to-end — no Apple-side setup or separate test required. **RevenueCat**: api_key is copied verbatim; a fresh webhook_secret is generated on the target and returned in \`webhook_setup\` for the user to paste into RC. Credentials are **duplicated, not shared** — rotating the source does not update copies.
- \`sync-integration\` — Trigger sync: \`provider\` (\`revenuecat\` default, or \`apple-search-ads\`), bulk (omit \`user_id\`, queues job) or single user (with \`user_id\`, synchronous)

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
| \`issues:read\` | list-issues, get-issue, list-issue-comments |
| \`issues:write\` | resolve-issue, silence-issue, reopen-issue, claim-issue, merge-issues, add-issue-comment |
| \`integrations:read\` | list-providers, list-integrations |
| \`integrations:write\` | add-integration, update-integration, remove-integration, copy-integration, sync-integration |
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
1. \`query-events\` → search for specific events, errors, or user activity. Use \`session_id\` to reconstruct a full user session.
2. \`query-metric\` → aggregated performance stats with grouping
3. \`list-metric-events\` → drill into individual metric events
4. \`query-funnel\` → conversion rates and drop-off analysis

### Investigating issues
1. \`list-issues\` → find open issues sorted by severity
2. \`claim-issue\` → mark as in_progress
3. \`get-issue\` → read occurrences (each has \`session_id\`, \`event_id\`, \`user_id\`)
4. \`query-events\` with \`session_id\` (add \`compact: true\` for long sessions) → reconstruct the full session timeline to see what led to the error
5. \`get-event\` with \`event_id\` → read the full error details (custom_attributes, stack trace)
6. Repeat for multiple occurrences to find common patterns
7. \`add-issue-comment\` → document root cause and findings
8. \`resolve-issue\` → mark resolved with fix version

### Connecting integrations (RevenueCat)
1. Ask the user for their RevenueCat V2 Secret API key (the only input needed)
2. \`add-integration\` with \`api_key\` only → returns \`webhook_setup\` with all webhook form values
3. Present the webhook setup to the user to paste into RevenueCat
4. \`sync-integration\` with \`project_id\` (omit \`user_id\`) → queues a bulk background job to backfill existing subscriber data
5. \`get-job\` with the returned \`job_run_id\` → monitor sync progress

## SDK Integration Guides

This MCP server provides SDK integration guides as resources. Read the relevant guide when you need to install, configure, or instrument an SDK in the user's codebase.

| Resource | SDK | Use when |
|---|---|---|
| \`owlmetry://skills/swift\` | Swift SDK | Instrumenting iOS, iPadOS, or macOS apps (SwiftUI or UIKit) |
| \`owlmetry://skills/node\` | Node.js SDK | Instrumenting backend services (Express, Fastify, serverless, etc.) |

Each guide covers the full SDK surface. Summary:

- **Swift** — package installation, \`Owl.configure()\`, event logging, automatic screen tracking, structured metrics, funnels, A/B experiments, user identity, user properties, **error attachments**, **feedback collection** (drop-in \`OwlFeedbackView\` or programmatic \`Owl.sendFeedback\`), **Apple Search Ads attribution** (auto-capture, opt-out, manual submission), and reading \`Owl.sessionId\` to forward to a backend for session correlation.
- **Node** — package installation, \`Owl.configure()\`, event logging, structured metrics, funnels, A/B experiments, user identity, user properties, **error attachments**, **feedback forwarding** (when the team collects feedback through their own frontend and wants it pushed to OwlMetry with \`Owl.sendFeedback\`), and **per-request session/user scoping** (\`Owl.withSession(...)\` / \`Owl.withUser(...)\` / per-call \`options.sessionId\`) for linking backend events to a client session via the \`X-Owl-Session-Id\` header.

**Note:** The guides reference CLI commands for creating metrics and funnels. You can use the equivalent MCP tools instead (\`create-metric\`, \`create-funnel\`).

## Key Notes

- \`bundle_id\` is **immutable after creation** — to change it, delete and recreate the app. Backend apps have no bundle_id.
- Agent keys are for reading/managing. Client keys are for SDK event ingestion.
- Metric and funnel definitions must exist on the server before the SDK emits events for that slug.
- Cursor-based pagination: use the \`cursor\` from the response to fetch the next page. \`has_more\` indicates more results.
- All write tools that modify resources are recorded in the audit log.
- Soft-deleted resources can be restored by creating a new resource with the same slug.

## Bulk Import

To migrate historical event data from another system into OwlMetry:

1. **Create an import key** using the \`create-import-key\` tool with the target \`app_id\`.
2. **Write an export script** that reads events from the source system and POSTs them to \`POST /v1/import\` with the import key as a Bearer token.
3. Each request can contain up to **1000 events**. There is **no timestamp restriction** — any historical date is accepted.
4. Events with a matching \`client_event_id\` are **updated** (not skipped), so re-running an import script after tweaking attributes is safe.
5. The request body is \`{ "events": [...] }\` — same event shape as SDK ingestion (\`message\`, \`level\`, \`session_id\` required; \`timestamp\`, \`user_id\`, \`custom_attributes\`, etc. optional).
6. Metric events (\`metric:slug:phase\` messages) and funnel events (\`step:step_name\` messages, or legacy \`track:step_name\`) are auto-detected and dual-written.
7. Import keys use the \`owl_import_\` prefix and are scoped to a single app.
`;
