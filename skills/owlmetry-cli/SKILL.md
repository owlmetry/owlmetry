---
name: owlmetry-cli
version: 0.1.15
description: >-
  Install the OwlMetry CLI, sign up, and manage projects, apps, metrics,
  funnels, and events. Use when adding OwlMetry to a project, querying
  analytics, or when another OwlMetry skill needs CLI setup as a prerequisite.
  IMPORTANT: You MUST load this skill before running ANY `owlmetry` CLI
  command. The CLI has non-obvious subcommand syntax and flags — do not guess.
allowed-tools: Bash
---

## What is OwlMetry?

OwlMetry is a self-hosted analytics platform for mobile and backend apps. It captures events, structured metrics, and funnel conversions from client SDKs (Swift, Node.js), stores them in a partitioned PostgreSQL database, and exposes query and management APIs.

The **CLI** is the management and query tool — it does not ingest events. You use it to create projects and apps, define metrics and funnels, query event data, and view analytics. SDKs handle event ingestion using client keys (`owl_client_...`). The CLI uses agent keys (`owl_agent_...`) for reading data and managing resources.

> **Do not guess CLI syntax.** The `owlmetry` command has specific subcommand patterns (e.g., `owlmetry apps` not `owlmetry apps list`, flags like `--format json` not `--message`). Always reference the command documentation in this skill file before running a command. If you haven't loaded this skill yet, load it first.

## Version Check

Run these checks silently. Only inform the user if updates are available.

1. **Skill version**: `curl -sf https://raw.githubusercontent.com/Jasonvdb/owlmetry/main/skills/owlmetry-cli/SKILL.md | head -5` — compare the remote `version:` field to this file's `version:` frontmatter above. If the remote version is newer, ask the user if they want to update the local skill file.
2. **CLI version** (if installed): compare `owlmetry --version` to `npm view @owlmetry/cli version 2>/dev/null`. If a newer version exists, offer `npm install -g @owlmetry/cli@latest`.

If everything is current or the remote is unreachable, continue silently.

## Setup

Follow these steps in order. Skip any step that's already done.

### Step 1 — Install the CLI

**Prerequisites:** Node.js 20+

```bash
npm install -g @owlmetry/cli
```

### Step 2 — Check authentication

```bash
owlmetry whoami --format json
```

If this succeeds, authentication is already configured — skip to Step 3.

If it fails (missing config or invalid key), run the auth flow:

1. Ask the user for their email address.
2. Send a verification code:
   ```bash
   owlmetry auth send-code --email <user-email>
   ```
3. Ask the user for the 6-digit code from their email.
4. Verify and save credentials:
   ```bash
   owlmetry auth verify --email <user-email> --code <code> --format json
   ```
   This creates the user account and team (if new), generates an agent API key (`owl_agent_...`), and saves config to `~/.owlmetry/config.json`. Default API endpoint: `https://api.owlmetry.com`. Default ingest endpoint: `https://ingest.owlmetry.com`.

**Multi-team setup**: If the user belongs to multiple teams, run `auth verify` once per team (using `--team-id` to select each team). Each team's key is stored as a separate profile. The last verified team becomes the active profile.

**Switching teams**: Use `owlmetry switch` to list profiles or `owlmetry switch <name-or-slug>` to switch the active team. Use `--team <name-or-slug>` on any command to use a different team's key for a single command without switching.

**Manual setup** (if the user already has an API key):
```bash
owlmetry setup --endpoint <url> --api-key <key> [--ingest-endpoint <url>]
```

### Step 3 — Create project and app

After authentication, set up the resources the SDK needs. Check if any projects already exist:

```bash
owlmetry projects --format json
```

If the user already has a project and app, skip to SDK integration.

**Create a project** — infer a good name from the user's repository or directory name:
```bash
owlmetry projects create --name "<ProjectName>" --slug "<project-slug>" --format json
```
Save the returned `id` — you need it for the next command.

**Create an app** — choose the platform based on the project type:
- Swift/SwiftUI → `apple`
- Kotlin/Android → `android`
- Web frontend → `web`
- Node.js/backend → `backend`

```bash
owlmetry apps create --project-id <project-id> --name "<AppName>" --platform <platform> [--bundle-id <bundle-id>] --format json
```
- `--bundle-id` is required for apple/android/web (e.g., `com.example.myapp`), omitted for backend.
- The response includes a `client_key` (`owl_client_...`) — this is the SDK API key for event ingestion. Save it.

### Step 4 — Integrate the SDK

Use the `client_key` from Step 3 to configure the appropriate SDK:
- **Node.js projects** → follow the `owlmetry-node` skill file
- **Swift/iOS projects** → follow the `owlmetry-swift` skill file

Pass the **ingest endpoint** and client key to the SDK's `configure()` call. Read `~/.owlmetry/config.json` for the `ingest_endpoint` value (set during auth). For the hosted platform it's `https://ingest.owlmetry.com`. For self-hosted it defaults to the API endpoint.

### Step 5 — Add to project's CLAUDE.md

Add this to the project's `CLAUDE.md` so future sessions know OwlMetry is integrated and load the right skills:

```markdown
### OwlMetry
Load the `/owlmetry-cli` skill before running any `owlmetry` CLI commands or doing analytics work — it links to the appropriate SDK skill for your platform.
```

## Resource Hierarchy

OwlMetry organises resources in a `Team → Project → Apps` hierarchy:

- **Team** — the top-level account. Users belong to one or more teams. All resources (projects, apps, keys) are team-scoped.
- **Project** — groups related apps under one product (e.g., "MyApp" project). Metrics and funnels are defined at the project level so they span all apps in the project.
- **App** — represents a single deployable artifact. Each app has a `platform` (`apple`, `android`, `web`, `backend`) and, for non-backend platforms, a `bundle_id`. Creating an app auto-generates a `client_key` for SDK use.

Projects group apps cross-platform: an iOS app and its backend API can share the same project, enabling unified funnel and metric analysis across both.

## Discovering IDs

Always use CLI commands to get IDs — never read `~/.owlmetry/config.json` directly.

- **Team ID**: `owlmetry whoami --format json` → `.teams[].id`
- **Project ID**: `owlmetry projects --format json` → `[].id`
- **App ID**: `owlmetry apps list --format json` → `[].id` (also returns `client_key`)

## Command Quick Reference

Copy-paste ready. All commands support `--format json` for machine-readable output. Global flags: `--endpoint <url>`, `--api-key <key>`, `--team <name-or-id>`.

```
# Auth
owlmetry auth send-code --email <email>
owlmetry auth verify --email <email> --code <code> --format json
owlmetry whoami --format json
owlmetry switch [<name-or-slug>]
owlmetry setup --endpoint <url> --api-key <key> [--ingest-endpoint <url>]

# Projects
owlmetry projects --format json
owlmetry projects view <id> --format json
owlmetry projects create --name <name> --slug <slug> [--team-id <id>] --format json
owlmetry projects update <id> --name <name> --format json

# Apps
owlmetry apps list [--project-id <id>] --format json
owlmetry apps view <id> --format json
owlmetry apps create --project-id <id> --name <name> --platform <platform> [--bundle-id <id>] --format json
owlmetry apps update <id> --name <name> --format json

# Metrics
owlmetry metrics list --project-id <id> --format json
owlmetry metrics view <slug> --project-id <id> --format json
owlmetry metrics create --project-id <id> --name <name> --slug <slug> [--lifecycle] [--description <desc>] --format json
owlmetry metrics update <slug> --project-id <id> [--name <name>] [--description <desc>] --format json
owlmetry metrics delete <slug> --project-id <id>
owlmetry metrics events <slug> --project-id <id> [--phase <phase>] [--user-id <id>] [--since <time>] [--until <time>] --format json
owlmetry metrics query <slug> --project-id <id> [--since <time>] [--until <time>] [--app-id <id>] [--user-id <id>] [--group-by <field>] --format json

# Funnels
owlmetry funnels list --project-id <id> --format json
owlmetry funnels view <slug> --project-id <id> --format json
owlmetry funnels create --project-id <id> --name <name> --slug <slug> --steps-file <path> [--description <desc>] --format json
owlmetry funnels update <slug> --project-id <id> --steps-file <path> --format json
owlmetry funnels delete <slug> --project-id <id>
owlmetry funnels query <slug> --project-id <id> [--since <time>] [--until <time>] [--closed] [--group-by <field>] --format json

# Integrations
owlmetry integrations providers
owlmetry integrations list --project-id <id> --format json
owlmetry integrations add <provider> --project-id <id> --api-key <key> [--webhook-secret <secret>] --format json
owlmetry integrations update <provider> --project-id <id> [--api-key <key>] [--webhook-secret <secret>] [--enable] [--disable] --format json
owlmetry integrations remove <provider> --project-id <id>
owlmetry integrations sync <provider> --project-id <id> [--user <userId>] --format json

# Events
owlmetry events [--project-id <id>] [--app-id <id>] [--level <level>] [--user-id <id>] [--session-id <id>] [--since <time>] [--limit <n>] --format json
owlmetry events view <id> --format json
owlmetry investigate <eventId> [--window <minutes>] --format json

# Users
owlmetry users <app-id> [--anonymous] [--real] [--search <query>] [--limit <n>] --format json

# Audit Logs
owlmetry audit-log list --team-id <id> [--resource-type <type>] [--actor-id <id>] [--action <action>] [--since <time>] --format json
```

## Resource Management

### Projects

Projects group apps by product and scope metrics and funnels. Create one project per product (e.g., "Acme" with iOS + backend apps under it).

```bash
owlmetry projects --format json                                        # List all
owlmetry projects view <id> --format json                              # View details + apps
owlmetry projects create --name <name> --slug <slug> [--team-id <id>] --format json
owlmetry projects update <id> --name <new-name> --format json
```

### Apps

An app represents a single deployable target. The `client_key` returned on creation is what SDKs use for event ingestion. The `bundle_id` is **immutable after creation** — to change it, delete and recreate the app. Backend apps have no bundle_id.

```bash
owlmetry apps list --format json                                       # List all
owlmetry apps list --project-id <id> --format json                     # List by project
owlmetry apps view <id> --format json                                  # View details
owlmetry apps create --project-id <id> --name <name> --platform <platform> [--bundle-id <id>] --format json
owlmetry apps update <id> --name <new-name> --format json
```

- **Platforms:** `apple`, `android`, `web`, `backend`
- `--bundle-id` is required for apple/android/web, omitted for backend
- The create response includes `client_key` — this is the SDK API key

### Metric Definitions

Metrics are project-scoped definitions that tell OwlMetry what structured data to expect from SDKs. There are two kinds:

- **Lifecycle metrics** (`--lifecycle`): track operations with a start → complete/fail/cancel flow. Use for things with duration — API calls, uploads, database queries. The SDK auto-tracks `duration_ms`.
- **Single-shot metrics** (no `--lifecycle`): record a point-in-time measurement. Use for snapshots — cache hit rates, queue depth, cold start time.

The metric definition must exist on the server **before** the SDK emits events for that slug, otherwise the server will reject the events.

```bash
owlmetry metrics list --project-id <id> --format json                   # List all
owlmetry metrics view <slug> --project-id <id> --format json           # View details
owlmetry metrics create --project-id <id> --name <name> --slug <slug> [--lifecycle] [--description <desc>] --format json
owlmetry metrics update <slug> --project-id <id> [--name <name>] [--description <desc>] --format json
owlmetry metrics delete <slug> --project-id <id>
```

Slugs: lowercase letters, numbers, hyphens only (`/^[a-z0-9-]+$/`).

### Funnel Definitions

Funnels measure how users progress through a multi-step flow and where they drop off. Each funnel has an ordered list of steps, and each step has an `event_filter` that matches on `step_name` and/or `screen_name`.

Step definitions match directly on the step name passed to `track()` in the SDK — no prefix or transformation needed.

Both modes group events by `user_id` — events with no `user_id` are excluded from funnel analytics. Funnels support two analysis modes:
- **Closed mode** (`--closed` on query): sequential — a user must complete steps in order. The system uses each user's earliest timestamp per step and requires strict chronological ordering (step 2 must occur after step 1). Use for linear flows like onboarding or checkout.
- **Open mode** (default): independent — each step counts distinct users separately, regardless of other steps.

Maximum 20 steps per funnel.

```bash
owlmetry funnels list --project-id <id> --format json                   # List all
owlmetry funnels view <slug> --project-id <id> --format json           # View details
owlmetry funnels delete <slug> --project-id <id>
```

**Creating funnels** — use `--steps-file` to avoid shell quoting issues with JSON:

```bash
# 1. Write steps to a JSON file
cat > /tmp/funnel-steps.json << 'EOF'
[
  {"name": "Step Name", "event_filter": {"step_name": "step-name"}},
  {"name": "Next Step", "event_filter": {"step_name": "next-step"}}
]
EOF

# 2. Create the funnel referencing the file
owlmetry funnels create --project-id <id> --name <name> --slug <slug> \
  --steps-file /tmp/funnel-steps.json [--description <desc>] --format json
```

**Updating funnel steps** — same pattern:
```bash
owlmetry funnels update <slug> --project-id <id> --steps-file /tmp/updated-steps.json --format json
```

Inline `--steps '<json>'` also works but is error-prone in shell environments due to JSON quoting. Prefer `--steps-file`.

Steps JSON format: `[{"name":"Step Name","event_filter":{"step_name":"step-name"}}]`

### Integrations

Integrations connect third-party services (e.g., RevenueCat) to sync data into user properties. Configured per-project.

```bash
owlmetry integrations providers                                              # List supported providers
owlmetry integrations list --project-id <id> --format json                   # List configured
owlmetry integrations add revenuecat --project-id <id> --api-key <key> --format json
owlmetry integrations update revenuecat --project-id <id> --api-key <key> --format json
owlmetry integrations remove revenuecat --project-id <id>
owlmetry integrations sync revenuecat --project-id <id>                      # Bulk sync all users
owlmetry integrations sync revenuecat --project-id <id> --user <userId>      # Single user
```

After adding RevenueCat, configure the webhook URL in RevenueCat's dashboard: `https://api.owlmetry.com/v1/webhooks/revenuecat/<projectId>`. The integration syncs subscription status, product, entitlements, and revenue into user properties (prefixed `rc_`).

## Querying

### Events

Events are the raw log records emitted by SDKs — every `Owl.info()`, `Owl.error()`, `Owl.track()`, etc. Query events when debugging specific issues, investigating user behavior, or reviewing what happened in a time window.

```bash
owlmetry events [--project-id <id>] [--app-id <id>] [--since <time>] [--until <time>] [--level info|debug|warn|error] [--user-id <id>] [--session-id <id>] [--screen-name <name>] [--limit <n>] [--cursor <cursor>] [--data-mode production|development|all] --format json
owlmetry events view <id> --format json
```

Defaults to last 24 hours if no `--since`/`--until` specified.

### Investigate (contextual events)

Investigate works like a flight recorder — given a single event ID, it returns the surrounding events from the same app within a time window. Use this when you have a specific error or anomaly and want to see what happened immediately before and after it.

```bash
owlmetry investigate <eventId> [--window <minutes>] --format json
```

Shows events surrounding a target event. Default window: 5 minutes.

### Users

```bash
owlmetry users <app-id> [--anonymous] [--real] [--search <query>] [--limit <n>] --format json
```

`--anonymous` and `--real` are mutually exclusive.

### Metric Events & Aggregation

There are two ways to look at metric data:

- **`metrics events`** — raw metric event records, useful for debugging individual operations (e.g., "why did this specific upload fail?"). Shows each start/complete/fail/cancel/record event individually.
- **`metrics query`** — aggregated statistics (count, avg/p50/p95/p99 duration, error rate), useful for spotting trends and regressions. Supports grouping by app, version, environment, device, or time bucket.

```bash
owlmetry metrics events <slug> --project-id <id> [--phase start|complete|fail|cancel|record] [--tracking-id <id>] [--user-id <id>] [--since <time>] [--until <time>] [--environment <env>] [--data-mode <mode>] --format json
owlmetry metrics query <slug> --project-id <id> [--since <time>] [--until <time>] [--app-id <id>] [--app-version <v>] [--environment <env>] [--user-id <id>] [--group-by app_id|app_version|device_model|os_version|environment|time:hour|time:day|time:week] [--data-mode <mode>] --format json
```

### Funnel Analytics

Funnel queries return conversion rates and drop-off between steps. The output shows how many users entered each step and what percentage continued to the next. Use `--group-by` to segment results and compare conversion across environments, app versions, or A/B experiment variants.

```bash
owlmetry funnels query <slug> --project-id <id> [--since <time>] [--until <time>] [--closed] [--app-version <v>] [--environment <env>] [--experiment <name:variant>] [--group-by environment|app_version|experiment:<name>] [--data-mode <mode>] --format json
```

`--closed` = closed (sequential) funnel mode. Without this flag, open mode is used (steps evaluated independently).

### Audit Logs

Audit logs record who performed what action on which resource — creating an app, revoking an API key, changing a team member's role, etc. Query them when investigating configuration changes or tracking administrative activity. Requires `audit_logs:read` permission on the agent key (included in default agent key permissions).

```bash
owlmetry audit-log list --team-id <id> [--resource-type <type>] [--resource-id <id>] [--actor-id <id>] [--action create|update|delete] [--since <time>] [--until <time>] [--limit <n>] --format json
```

## Key Notes

- Always use `--format json` when parsing output programmatically.
- **Global flags** available on all commands: `--endpoint <url>`, `--api-key <key>`, `--ingest-endpoint <url>`, `--team <name-or-id>`, `--format <format>`
- **Team profiles**: Config stores multiple team profiles keyed by team ID. `owlmetry switch` lists/switches the active profile. `--team` flag on any command uses a specific team's key without switching the active profile.
- **Two endpoints**: `endpoint` is the API server (for CLI/agent queries). `ingest_endpoint` is where SDKs send events. Both are saved in `~/.owlmetry/config.json`. For the hosted platform: `api.owlmetry.com` and `ingest.owlmetry.com`. For self-hosted: ingest defaults to the same as the API endpoint.
- **Config format**: `~/.owlmetry/config.json` stores `endpoint`, `ingest_endpoint`, `active_team` (team ID), and `teams` (a map of team ID → `{ api_key, team_name, team_slug }`).
- **Agent keys** (`owl_agent_...`) are for CLI queries. **Client keys** (`owl_client_...`) are for SDK event ingestion.
- **Time format:** relative (`1h`, `30m`, `7d`) or ISO 8601 (`2026-03-20T00:00:00Z`). Relative times go backwards from now — `1h` means "the last hour", `7d` means "the last 7 days".
- **Data mode:** `production` (default), `debug`, or `all` — filters events by their debug flag. SDKs auto-detect debug mode (DEBUG builds on iOS, `NODE_ENV !== "production"` on Node). Use `debug` mode during development to see test events; use `production` (the default) for real analytics.
- Ask the user for their email address; the verification code arrives by email.

## Typical Workflow

A typical end-to-end flow for adding OwlMetry to a new project:

1. **Sign up** (CLI): `owlmetry auth send-code` → verify code → team created, config saved
2. **Create a project** (CLI): `owlmetry projects create --name "..." --slug "..." --format json`
3. **Create apps** (CLI): `owlmetry apps create --platform apple --bundle-id com.example.myapp` (and/or android, web, backend)
4. **Note the client key**: from the app creation response — pass this to the SDK
5. **Integrate the SDK** (switch to `/owlmetry-swift` or `/owlmetry-node` skill): Add the SDK dependency, configure with `ingest_endpoint` and client key, verify the project builds

After setup, the SDK skill will prompt the user to choose which instrumentation to start with. The three areas and what's needed:

| Area | CLI setup needed? | SDK skill |
|------|-------------------|-----------|
| **Event & error logging** | No — just add SDK calls | `Owl.info()`, `Owl.error()`, `Owl.warn()`, `Owl.debug()` |
| **Structured metrics** | Yes — `owlmetry metrics create` for each metric slug | `Owl.startOperation()`, `Owl.recordMetric()` |
| **Funnel tracking** | Yes — `owlmetry funnels create` with steps JSON | `Owl.track("step-name")` |

For metrics and funnels, the CLI defines **what** to track (server-side definitions), and the SDK implements **where** to track it (code instrumentation). The definition must exist before the SDK emits events for that slug.

6. **Query data** (CLI): Use `owlmetry events`, `owlmetry metrics query`, and `owlmetry funnels query` to analyze behavior
