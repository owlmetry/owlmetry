---
name: owlmetry-cli
version: 0.1.0
description: >-
  Install the OwlMetry CLI, sign up, and manage projects, apps, metrics,
  funnels, and events. Use when adding OwlMetry to a project, querying
  analytics, or when another OwlMetry skill needs CLI setup as a prerequisite.
allowed-tools: Bash
---

## Version Check

Run these checks silently. Only inform the user if updates are available.

1. **Skill version**: `curl -sf https://raw.githubusercontent.com/Jasonvdb/owlmetry/main/skills/owlmetry-cli/SKILL.md | head -5` — compare the `version:` field to `0.1.0`. If newer, ask the user if they want to update the local skill file.
2. **CLI version** (if installed): compare `owlmetry --version` to `npm view @owlmetry/cli version 2>/dev/null`. If a newer version exists, offer `npm install -g @owlmetry/cli@latest`.

If everything is current or the remote is unreachable, continue silently.

## Setup

**Prerequisites:** Node.js 20+

**Install:**
```bash
npm install -g @owlmetry/cli
```

**Sign up / log in:**
```bash
owlmetry auth send-code --email <user-email>
```
Ask the user for the 6-digit verification code that arrives by email, then:
```bash
owlmetry auth verify --email <user-email> --code <code> --format json
```

- New users are auto-provisioned with a team, project, and backend app.
- The response includes an agent API key (`owl_agent_...`), team ID, project ID, and app details.
- Config is saved to `~/.owlmetry/config.json`.
- Default endpoint: `https://api.owlmetry.com`

If the user already has a config file (`~/.owlmetry/config.json`), they're already set up — skip auth.

**Manual setup** (if the user already has an API key):
```bash
owlmetry setup --endpoint <url> --api-key <key>
```

## Resource Management

### Projects

```bash
owlmetry projects --format json                                        # List all
owlmetry projects view <id> --format json                              # View details + apps
owlmetry projects create --team-id <id> --name <name> --slug <slug> --format json
owlmetry projects update <id> --name <new-name> --format json
```

### Apps

```bash
owlmetry apps --format json                                            # List all
owlmetry apps --project <id> --format json                             # List by project
owlmetry apps view <id> --format json                                  # View details
owlmetry apps create --project-id <id> --name <name> --platform <platform> [--bundle-id <id>] --format json
owlmetry apps update <id> --name <new-name> --format json
```

- **Platforms:** `apple`, `android`, `web`, `backend`
- `--bundle-id` is required for apple/android/web, omitted for backend
- The create response includes `client_key` — this is the SDK API key

### Metric Definitions

```bash
owlmetry metrics --project <id> --format json                          # List all
owlmetry metrics view <slug> --project <id> --format json              # View details
owlmetry metrics create --project <id> --name <name> --slug <slug> [--lifecycle] [--description <desc>] --format json
owlmetry metrics update <slug> --project <id> [--name <name>] [--status active|paused] --format json
owlmetry metrics delete <slug> --project <id>
```

Slugs: lowercase letters, numbers, hyphens only (`/^[a-z0-9-]+$/`).

### Funnel Definitions

```bash
owlmetry funnels --project <id> --format json                          # List all
owlmetry funnels view <slug> --project <id> --format json              # View details
owlmetry funnels create --project <id> --name <name> --slug <slug> --steps '<json>' [--description <desc>] --format json
owlmetry funnels update <slug> --project <id> [--name <name>] [--steps '<json>'] --format json
owlmetry funnels delete <slug> --project <id>
```

Steps JSON format: `[{"name":"Step Name","event_filter":{"message":"track:step-name"}}]`

## Querying

### Events

```bash
owlmetry events [--project <id>] [--app <id>] [--since <time>] [--until <time>] [--level info|debug|warn|error] [--user <id>] [--session <id>] [--screen <name>] [--limit <n>] [--cursor <cursor>] [--data-mode production|debug|all] --format json
owlmetry events view <id> --format json
```

Defaults to last 24 hours if no `--since`/`--until` specified.

### Investigate (contextual events)

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

```bash
owlmetry metrics events <slug> --project <id> [--phase start|complete|fail|cancel|record] [--tracking-id <id>] [--user <id>] [--since <time>] [--until <time>] [--environment <env>] [--data-mode <mode>] --format json
owlmetry metrics query <slug> --project <id> [--since <date>] [--until <date>] [--app <id>] [--app-version <v>] [--environment <env>] [--user <id>] [--group-by app_id|app_version|device_model|os_version|environment|time:hour|time:day|time:week] [--data-mode <mode>] --format json
```

### Funnel Analytics

```bash
owlmetry funnels query <slug> --project <id> [--since <date>] [--until <date>] [--open] [--app-version <v>] [--environment <env>] [--experiment <name:variant>] [--group-by environment|app_version|experiment:<name>] [--data-mode <mode>] --format json
```

`--open` = open funnel mode (steps evaluated independently, not sequentially).

### Audit Logs

```bash
owlmetry audit-log list --team <id> [--resource-type <type>] [--resource-id <id>] [--actor <id>] [--action create|update|delete] [--since <time>] [--until <time>] [--limit <n>] --format json
```

## Key Notes

- Always use `--format json` when parsing output programmatically.
- **Global flags** available on all commands: `--endpoint <url>`, `--api-key <key>`, `--format <format>`
- **Agent keys** (`owl_agent_...`) are for CLI queries. **Client keys** (`owl_client_...`) are for SDK event ingestion.
- **Time format:** relative (`1h`, `30m`, `7d`) or ISO 8601 (`2026-03-20T00:00:00Z`).
- **Data mode:** `production` (default), `debug`, or `all` — filters events by debug flag.
- Ask the user for their email address; the verification code arrives by email.
