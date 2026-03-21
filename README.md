# OwlMetry

Agent-first observability. One Postgres instance. No humans required.

OwlMetry is a self-hosted observability platform designed for the agentic development era. Point your coding agent at the setup instructions, and it handles everything — integration, monitoring, debugging, performance analysis. The developer doesn't need to open a dashboard, configure alerts, or interpret charts. The agent does it all through the CLI.

Most observability tools are built for humans staring at dashboards. OwlMetry is built for agents making API calls. Every feature is accessible programmatically through agent API keys, a CLI, and a complete REST API. The web dashboard exists as an optional visual layer — not the primary interface.

> **Warning:** This project is in active development and is not yet production-ready. APIs, schemas, and configuration may change without notice.

## Why agent-first?

Traditional observability requires a human in the loop: someone to check dashboards, read alerts, interpret metrics, and decide what to fix. That made sense when humans wrote all the code. It doesn't make sense when your agent is already writing the code — it should also be the one monitoring it.

With OwlMetry, your agent can:

1. **Set up observability** — create projects, register apps, and integrate the SDK into your codebase
2. **Monitor in production** — query events, filter by level/app/time, investigate error clusters
3. **Diagnose issues** — pull events around an incident window, correlate sessions, trace user journeys
4. **Act on what it finds** — the agent reads the data, understands the problem, and writes the fix

The dashboard is there if you want to look. But you shouldn't have to.

## Why self-hosted?

Your analytics data is some of the most sensitive information you have — user behavior, device details, session traces, error logs. OwlMetry keeps all of it on your own infrastructure. No data leaves your servers, no third-party vendor has access, no privacy policy to hope they follow. This isn't a feature toggle — it's the architecture. Self-hosted by design means GDPR, HIPAA, and SOC 2 compliance becomes a property of your infrastructure, not a vendor promise.

And self-hosted doesn't have to mean complex. OwlMetry runs on a single Postgres instance. One database, one API server. That's the entire backend. Monthly partitioning handles event volume, auto-pruning manages disk space, and Postgres does what it's been doing reliably for decades.

## Features

- **Agent-native API** — every operation available through `owl_agent_` keys: query events, list apps, read projects, analyze funnels. Agents are first-class citizens, not an afterthought
- **CLI for agents and humans** — `--format json` for machine consumption, `--format table` for humans. Same tool, both audiences
- **Event ingestion** — batch ingest up to 100 events per request with deduplication; supports gzip-compressed payloads
- **Projects & apps** — organize apps by product across platforms (`apple`, `android`, `web`, `backend`); Apple platform covers iOS, iPadOS, and macOS with a single app
- **Device tracking** — environment, OS version, app version, device model, locale, build number
- **Anonymous identity** — SDKs generate `owl_anon_` IDs; `/v1/identity/claim` retroactively links anonymous events to a known user
- **Bundle ID validation** — client API keys are scoped to an app's registered bundle ID, validated on every ingest request
- **Structured metrics** — define metrics, track operations with `startOperation`/`complete`/`fail`, query aggregations (counts, success rates, duration percentiles, error breakdowns) via API
- **Funnel analytics** — define conversion funnels and let your agent query drop-off rates programmatically
- **Lightweight A/B experiments** — SDKs assign random variants on first call, persist assignments locally, and tag all events with the active experiment; no server config needed
- **Audit trail** — automatic logging of who created, updated, or deleted resources; queryable via API, CLI, and dashboard
- **Dashboard optional** — Next.js web UI for when you want a visual overview. Not required for any workflow
- **Single Postgres** — no Kafka, no ClickHouse, no Redis. One database. Monthly partitioned events handle the scale
- **Auth model** — `owl_client_` keys for SDKs, `owl_agent_` keys for agents/CLI, JWT for the optional dashboard. Role-based access: **owner** > **admin** > **member**
- **Team invitations** — token-based email invitations with 7-day expiry; public accept page handles auth redirects automatically
- **Team management** — create teams, invite members by email, change roles, remove members
- **Database auto-pruning** — optional size limit (`MAX_DATABASE_SIZE_GB`); drops oldest partitions first

## Architecture

```
apps/server        Fastify API server (port 4000) — the core of OwlMetry
apps/cli           CLI for agents and humans (agent key auth)
apps/web           Next.js dashboard (port 3000) — optional visual layer
sdks/swift         Swift SDK (Swift Package)
sdks/node          Node.js Server SDK (zero runtime dependencies)
packages/shared    Shared TypeScript types and constants
packages/db        Drizzle ORM schema, migrations, seed
demos/ios          iOS demo app
demos/node         Node.js demo server
deploy/            VPS deployment scripts (Ubuntu 24.04 setup)
```

The API server is the product. Everything else — the dashboard, the CLI, the SDKs — is a client of that API. This means your agent has the same capabilities as the web UI. Nothing is dashboard-only.

## Local Development

Requires Node.js >= 20, PostgreSQL >= 15, and pnpm.

```bash
# Install dependencies
pnpm install

# Create database
createdb owlmetry

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, etc.

# Run migrations (creates tables + event partitions)
pnpm db:migrate

# Seed dev data (creates admin user, team, project, app, API keys)
pnpm dev:seed

# Start the API server
pnpm dev:server

# Run tests (requires owlmetry_test database + Swift toolchain)
createdb owlmetry_test
pnpm test              # Vitest + Swift SDK + CLI integration tests
pnpm test:swift-sdk    # Swift SDK integration tests only
pnpm test:node-sdk     # Node SDK integration tests only
pnpm test:cli          # CLI tests (unit + formatter + integration)
pnpm test:coverage     # Server tests with code coverage reporting
```

## Self-Hosting

See [INSTALL.md](INSTALL.md) for the complete self-hosting guide — covers system dependencies, PostgreSQL, nginx, pm2, SSL, Cloudflare, firewall, and maintenance.

## API Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | None | Health check |
| `POST` | `/v1/auth/send-code` | None | Send email verification code |
| `POST` | `/v1/auth/verify-code` | None | Verify code and get JWT token |
| `POST` | `/v1/auth/agent-login` | None | Verify code + provision agent API key (auto-creates project/app for new users) |
| `POST` | `/v1/auth/logout` | None | Clear JWT token cookie |
| `GET` | `/v1/auth/me` | JWT | Get current user profile + teams |
| `PATCH` | `/v1/auth/me` | JWT | Update name |
| `GET` | `/v1/auth/teams` | JWT | List user's teams |
| `GET` | `/v1/auth/keys` | JWT | List API keys for user's teams |
| `GET` | `/v1/auth/keys/:id` | JWT | Get single API key metadata |
| `POST` | `/v1/auth/keys` | JWT (admin+) | Generate API key |
| `PATCH` | `/v1/auth/keys/:id` | JWT (admin+) | Update API key name or permissions |
| `DELETE` | `/v1/auth/keys/:id` | JWT (admin+) | Revoke an API key |
| `POST` | `/v1/teams` | JWT | Create a new team |
| `GET` | `/v1/teams/:teamId` | JWT | Get team details with members and pending invitations |
| `PATCH` | `/v1/teams/:teamId` | JWT (admin+) | Rename team |
| `DELETE` | `/v1/teams/:teamId` | JWT (owner) | Delete team |
| `GET` | `/v1/teams/:id/members` | JWT | List team members |
| `PATCH` | `/v1/teams/:id/members/:userId` | JWT (admin+) | Change member role |
| `DELETE` | `/v1/teams/:id/members/:userId` | JWT (admin+) | Remove member (or self-leave) |
| `GET` | `/v1/teams/:id/members/:userId/agent-keys` | JWT | List agent keys created by a member |
| `POST` | `/v1/teams/:id/invitations` | JWT (admin+) | Create or resend team invitation |
| `GET` | `/v1/teams/:id/invitations` | JWT | List pending invitations |
| `DELETE` | `/v1/teams/:id/invitations/:invitationId` | JWT (admin+) | Revoke invitation |
| `GET` | `/v1/invites/:token` | None | Get invitation details (public) |
| `POST` | `/v1/invites/accept` | JWT | Accept invitation and join team |
| `POST` | `/v1/ingest` | Client key | Batch ingest events |
| `GET` | `/v1/events` | Agent key / JWT | Query events with filters |
| `GET` | `/v1/events/:id` | Agent key / JWT | Get single event |
| `GET` | `/v1/projects` | `projects:read` / JWT | List projects |
| `GET` | `/v1/projects/:id` | `projects:read` / JWT | Get project with apps |
| `POST` | `/v1/projects` | `projects:write` / JWT (admin+) | Create project (requires team_id in body) |
| `PATCH` | `/v1/projects/:id` | `projects:write` / JWT (admin+) | Update project name |
| `DELETE` | `/v1/projects/:id` | JWT only (admin+) | Soft-delete project and its apps |
| `GET` | `/v1/apps` | `apps:read` / JWT | List apps |
| `GET` | `/v1/apps/:id` | `apps:read` / JWT | Get single app |
| `POST` | `/v1/apps` | `apps:write` / JWT (admin+) | Create app (requires project_id) |
| `PATCH` | `/v1/apps/:id` | `apps:write` / JWT (admin+) | Update app name |
| `DELETE` | `/v1/apps/:id` | JWT only (admin+) | Soft-delete app |
| `GET` | `/v1/apps/:id/users` | `apps:read` / JWT | List app users (paginated) |
| `POST` | `/v1/identity/claim` | Client key | Link anonymous events to a user ID |
| `GET` | `/v1/projects/:projectId/funnels` | `funnels:read` / JWT | List funnel definitions for project |
| `GET` | `/v1/projects/:projectId/funnels/:slug` | `funnels:read` / JWT | Get funnel definition |
| `GET` | `/v1/funnels/by-id/:id` | `funnels:read` / JWT | Get funnel definition by ID |
| `POST` | `/v1/projects/:projectId/funnels` | `funnels:write` / JWT (admin+) | Create funnel definition |
| `PATCH` | `/v1/projects/:projectId/funnels/:slug` | `funnels:write` / JWT (admin+) | Update funnel definition |
| `DELETE` | `/v1/projects/:projectId/funnels/:slug` | JWT only (admin+) | Soft-delete funnel definition |
| `GET` | `/v1/projects/:projectId/funnels/:slug/query` | `funnels:read` / JWT | Query funnel analytics (drop-off rates, grouping, experiments) |
| `GET` | `/v1/projects/:projectId/metrics` | `metrics:read` / JWT | List metric definitions for project |
| `GET` | `/v1/projects/:projectId/metrics/:slug` | `metrics:read` / JWT | Get metric definition with docs |
| `GET` | `/v1/metrics/by-id/:id` | `metrics:read` / JWT | Get metric definition by ID |
| `POST` | `/v1/projects/:projectId/metrics` | `metrics:write` / JWT (admin+) | Create metric definition |
| `PATCH` | `/v1/projects/:projectId/metrics/:slug` | `metrics:write` / JWT (admin+) | Update metric definition |
| `DELETE` | `/v1/projects/:projectId/metrics/:slug` | JWT only (admin+) | Soft-delete metric definition |
| `GET` | `/v1/projects/:projectId/metrics/:slug/query` | `metrics:read` / JWT | Aggregation endpoint (counts, rates, percentiles) |
| `GET` | `/v1/projects/:projectId/metrics/:slug/events` | `metrics:read` / JWT | Raw metric events (paginated) |
| `GET` | `/v1/teams/:teamId/audit-logs` | `audit_logs:read` / JWT (admin+) | Query audit log entries (paginated, cursor-based) |

## CLI

The CLI is a thin HTTP client over the OwlMetry API. It works equally well as a tool for coding agents (`--format json`) and for humans (`--format table`).

### Setup

```bash
# Build the CLI
pnpm build

# Configure endpoint and API key (saves to ~/.owlmetry/config.json)
node apps/cli/dist/index.js setup --endpoint http://localhost:4000 --api-key <agent-key>

# Or use environment variables
export OWLMETRY_ENDPOINT=http://localhost:4000
export OWLMETRY_API_KEY=<agent-key>
```

### Authentication

```bash
# Step 1: Agent sends verification code
owlmetry auth send-code --endpoint http://localhost:4000 --email alice@example.com

# Step 2: User provides the 6-digit code (from email or server logs)

# Step 3: Agent verifies code and gets agent API key
owlmetry auth verify --endpoint http://localhost:4000 --email alice@example.com --code 847291
# → Saves agent API key to ~/.owlmetry/config.json
```

New users automatically get a team, project, and backend app provisioned. The agent key is saved to config and used for all subsequent commands. Both commands are fully non-interactive — no prompts, all input via flags.

### Usage

```bash
# An agent can do all of this programmatically

# Projects & apps
owlmetry projects                              # List projects
owlmetry projects view <id>                    # Project details with apps
owlmetry projects create --team-id <id> --name "My Project" --slug my-project
owlmetry projects update <id> --name "New Name" # Rename project
owlmetry apps                                  # List apps
owlmetry apps --project <id>                   # Filter by project
owlmetry apps view <id>                        # App details
owlmetry apps create --project-id <id> --name "iOS App" --platform apple --bundle-id com.example.app
owlmetry apps update <id> --name "New Name"    # Rename app

# Events
owlmetry events --since 1h                     # Events from the last hour
owlmetry events --level error --app <id>       # Errors for a specific app
owlmetry events view <id>                      # Full event details
owlmetry investigate <eventId> --window 10     # Events ±10 min around target

# Users
owlmetry users <app-id>                        # List app users
owlmetry users <app-id> --real --search "alice" # Filter by type and search

# Metrics
owlmetry metrics --project <id>                # List metric definitions
owlmetry metrics view <slug> --project <id>    # Metric definition details
owlmetry metrics create --project <id> --name "Startup Time" --slug startup-time --lifecycle
owlmetry metrics update <slug> --project <id> --name "New Name"
owlmetry metrics delete <slug> --project <id>  # Soft-delete metric
owlmetry metrics query <slug> --project <id> --since 7d
owlmetry metrics events <slug> --project <id>  # Raw metric events

# Funnels
owlmetry funnels --project <id>                # List funnel definitions
owlmetry funnels view <slug> --project <id>    # Funnel definition details
owlmetry funnels create --project <id> --name "Onboarding" --slug onboarding --steps '[...]'
owlmetry funnels update <slug> --project <id> --name "New Name"
owlmetry funnels delete <slug> --project <id>  # Soft-delete funnel
owlmetry funnels query <slug> --project <id> --since 7d

# Audit log
owlmetry audit-log list --team <id>            # Query audit log entries
owlmetry audit-log list --resource-type app --action create
```

### Output Formats

- `--format json` — machine-readable, ideal for agents
- `--format table` (default) — human-readable tables
- `--format log` — color-coded log lines (best for tailing events)

## Node.js Server SDK

Zero-dependency server-side SDK. Your agent can add this to any Node.js project in seconds.

### Setup

1. Create a backend-platform app in OwlMetry (via dashboard, CLI, or API)
2. Use the generated `owl_client_` key

### Usage

```typescript
import { Owl } from '@owlmetry/node';

// Initialize at server startup
Owl.configure({
  endpoint: 'https://ingest.owlmetry.com',
  apiKey: 'owl_client_xxx',
  serviceName: 'api-server',
  appVersion: '1.0.0',
});

// Simple logging
Owl.info('User logged in', { route: '/auth/login' });
Owl.error('Payment failed', { error: err.message });
Owl.warn('Rate limit approaching', { endpoint: '/v1/ingest' });
Owl.debug('Cache miss', { key: 'user:123:profile' });

// Scoped logger with preset userId
const owl = Owl.withUser('user_123');
owl.info('Processing order');
owl.error('Payment failed', { error: err.message });

// Funnel tracking
Owl.track('signup-started');
Owl.track('signup-completed', { method: 'email' });

// Structured metrics — lifecycle operations
const op = Owl.startOperation('api-request', { endpoint: '/v1/users' });
// ... do work ...
op.complete();   // or op.fail('reason'), op.cancel()
// duration_ms is tracked automatically

// Structured metrics — single-shot measurement
Owl.recordMetric('cache-hit', { key: 'user:123' });

// A/B experiments
const variant = Owl.getVariant('onboarding-flow', ['control', 'streamlined']);
// Returns random variant on first call, persists to ~/.owlmetry/experiments.json
Owl.setExperiment('onboarding-flow', 'streamlined');  // Force a variant
Owl.clearExperiments();                                // Reset all assignments

// Manual flush (useful in scripts)
await Owl.flush();

// Graceful shutdown (flushes all buffered events)
await Owl.shutdown();
```

### Transport

- Events are buffered in memory and flushed every 5 seconds or when 20 events accumulate
- Payloads over 512 bytes are gzip-compressed
- Failed requests are retried up to 5 times with exponential backoff
- All logging methods never throw — errors go to `console.error` when `debug: true`
- `session_id` is generated per `configure()` call, representing the server process lifetime

### Serverless Environments

In short-lived environments (Firebase Cloud Functions, AWS Lambda), buffered events may be lost when the process freezes or terminates before the flush timer fires. Use `Owl.wrapHandler()` to automatically flush after each invocation:

```typescript
import { onRequest } from 'firebase-functions/v2/https';
import { Owl } from '@owlmetry/node';

Owl.configure({ endpoint: 'https://ingest.owlmetry.com', apiKey: 'owl_client_...' });

export const myFunction = onRequest(
  Owl.wrapHandler(async (req, res) => {
    Owl.info('Function invoked', { path: req.path });
    res.send('OK');
  }),
);
```

- **Safety net**: The SDK also registers a `beforeExit` hook that flushes any remaining events when the Node.js event loop drains, catching events that slip through without `wrapHandler`.
- **Use `wrapHandler`, not `shutdown()`** — `shutdown()` destroys the transport, which breaks warm container reuse. `wrapHandler` only flushes, keeping the SDK ready for the next invocation.

## Swift SDK

Native Swift SDK for iOS, iPadOS, and macOS. Distributed as a Swift Package.

### Setup

1. Add the package dependency pointing to your OwlMetry repo
2. Create an Apple-platform app in OwlMetry and use the generated `owl_client_` key

### Usage

```swift
import OwlMetry

// Initialize (typically in AppDelegate or @main App.init)
try Owl.configure(
    endpoint: "https://ingest.owlmetry.com",
    apiKey: "owl_client_xxx"
)

// Logging
Owl.info("User logged in")
Owl.error("Payment failed", customAttributes: ["reason": "insufficient_funds"])
Owl.warn("Retry limit approaching")
Owl.debug("Cache miss", screenName: "ProfileView")

// User identity
Owl.setUser("user_123")           // Link events to a known user
Owl.clearUser()                   // Revert to anonymous

// Funnel tracking
Owl.track("signup-started")
Owl.track("signup-completed", attributes: ["method": "apple"])

// Structured metrics — lifecycle operations
let op = Owl.startOperation("image-upload", attributes: ["format": "heic"])
// ... do work ...
op.complete()   // or op.fail("reason"), op.cancel()

// Structured metrics — single-shot
Owl.recordMetric("cache-hit", attributes: ["key": "user:123"])

// A/B experiments
let variant = Owl.getVariant("onboarding-flow", options: ["control", "streamlined"])
Owl.setExperiment("onboarding-flow", variant: "streamlined")
Owl.clearExperiments()

// Graceful shutdown
await Owl.shutdown()
```

### Transport

- Events are buffered and flushed periodically or when the buffer fills
- Payloads are gzip-compressed by default (`compressionEnabled: true`)
- Automatically flushes when the app enters the background (`flushOnBackground: true`)
- `session_id` is generated per `configure()` call

## Demo Apps

Both demo apps send events to the same "Demo Project" in the dashboard, showing iOS and backend events side by side.

### Node.js backend demo

A zero-dependency HTTP server using the Node SDK. Demonstrates `Owl.wrapHandler()` for auto-flushing and `Owl.withUser()` for scoped logging.

```bash
# Requires: OwlMetry server running on port 4000 with seeded data
cd sdks/node && npx tsc     # Build the Node SDK (if not already built)
pnpm dev:demo-node          # Starts on port 4007
```

Endpoints:
- `GET /health` — health check
- `POST /api/greet` — success path (info events): `{ "name": "Alice", "userId": "user-42" }`
- `POST /api/checkout` — error path (warn + error events): `{ "item": "Widget", "userId": "user-42" }`

### iOS demo

The iOS demo includes a "Backend Demo" section that calls the Node demo server. Set a User ID in the Identity section first so iOS and backend events share the same user.

```bash
# Requires: OwlMetry server (port 4000) + Node demo server (port 4007)
pnpm dev:server             # Terminal 1
pnpm dev:demo-node          # Terminal 2
# Build and run iOS demo on simulator (Terminal 3)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://localhost:5432/owlmetry` | PostgreSQL connection string |
| `JWT_SECRET` | `dev-secret-change-me` | Secret for signing JWTs |
| `PORT` | `4000` | API server port |
| `HOST` | `0.0.0.0` | API server bind address |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `WEB_APP_URL` | `http://localhost:3000` | Web dashboard URL (used for invitation email links) |
| `MAX_DATABASE_SIZE_GB` | `0` (disabled) | Max database size before pruning old events |
| `RESEND_API_KEY` | (empty) | Resend API key for sending verification emails; if unset, codes print to server console |
| `EMAIL_FROM` | `noreply@owlmetry.com` | From address for verification emails (requires Resend) |
| `COOKIE_DOMAIN` | (unset) | Cookie domain for cross-subdomain auth (e.g., `.yourdomain.com`); required when API and dashboard are on different subdomains |
