# OwlMetry

Agent-first observability. Self-hosted. Built for the way you actually ship now.

OwlMetry is an observability platform designed for the agentic development era. Point your coding agent at the setup instructions, and it handles everything — integration, monitoring, debugging, performance analysis. The developer doesn't need to open a dashboard, configure alerts, or interpret charts. The agent does it all through MCP, an API, or a CLI.

> **⚠️ Alpha Software** — OwlMetry is in early alpha. APIs, schemas, and configuration may change without notice. Not yet production-ready.

## Get Started

### Option A — MCP (recommended for AI agents)

Add the OwlMetry MCP server to your agent's config. It exposes the full product surface as tools, plus SDK integration guides as resources — no CLI install needed. See the [MCP setup docs](https://owlmetry.com/docs/mcp) for editor-specific instructions.

### Option B — CLI

```bash
npm install -g @owlmetry/cli
```

Then tell your agent to run `owlmetry skills` and install the relevant skill files. It handles the rest — account setup, SDK integration, instrumentation, and querying.

## Why agent-first?

Most observability tools are built for humans staring at dashboards. OwlMetry is built for agents making API calls. Every feature is accessible programmatically through agent API keys, a CLI, an MCP server, and a complete REST API. The web dashboard exists as an optional visual layer — not the primary interface.

With OwlMetry, your agent can:

1. **Set up observability** — create projects, register apps, integrate the SDK into your codebase
2. **Monitor in production** — query events, filter by level/app/time, investigate error clusters, watch user journeys
3. **Diagnose issues** — pull the cross-app session timeline around an incident, download crash attachments, read user feedback
4. **Act on what it finds** — the agent reads the data, understands the problem, and writes the fix

The dashboard is there if you want to look. But you shouldn't have to.

## Why self-hosted?

Your analytics data is some of the most sensitive information you have — user behavior, device details, session traces, error logs, crash dumps. OwlMetry keeps all of it on your own infrastructure. No data leaves your servers, no third-party vendor has access, no privacy policy to hope they follow. Self-hosted by design means GDPR, HIPAA, and SOC 2 compliance become properties of your infrastructure, not vendor promises.

And it's simple: one Postgres database, one Node.js API server, one optional Next.js dashboard. No Kafka, no ClickHouse, no Redis. A `deploy/` folder of Ubuntu scripts gets you from a fresh VPS to a running instance with backups, log rotation, and health checks.

## Features

### Ingestion and instrumentation
- **Event ingestion** — batch ingest up to 100 events per request with deduplication; gzip-compressed payloads supported
- **Bulk historical import** — import keys (`owl_import_`) scoped per project; `POST /v1/import` accepts up to 1000 events per request and upserts duplicates
- **Projects & apps** — organize apps by product across platforms (`apple`, `android`, `web`, `backend`); one Apple app covers iOS, iPadOS, and macOS
- **Device tracking** — environment, OS version, app version, device model, locale, build number; latest released version auto-detected per app (iTunes Lookup for Apple, max event version for others) and stale versions badged across surfaces
- **Country tracking** — server auto-derives country from Cloudflare's `CF-IPCountry` header at ingest; rendered as flags across the dashboard
- **Anonymous identity** — SDKs generate `owl_anon_` IDs; `/v1/identity/claim` retroactively links anonymous events to a known user, including late-arriving events after the claim
- **Bundle ID validation** — client API keys are scoped to an app's registered bundle ID, validated on every ingest request
- **A/B experiments** — SDKs assign random variants on first call, persist assignments locally, and tag all events with the active experiment; no server config needed

### Debugging and incident response
- **Issue tracker** — error events automatically clustered into issues by fingerprint, with status lifecycle (`new → in_progress → resolved → silenced → regressed`), agent/user comments, merge duplicates, semver-aware regression detection against `resolved_at_version`, first/last-seen app version tracking. Kanban board in the dashboard, full API, MCP, and CLI surface
- **Issue alerts** — per-project digest emails at configurable frequency (`none | hourly | 6_hourly | daily | weekly`), silent when nothing is new or regressed
- **Event attachments** — SDKs can upload files (logs, screenshots, crash dumps) alongside error events; stored on disk, linked to events and issues, downloadable via dashboard, CLI, and MCP. Per-project + per-user quotas. See [docs/concepts/attachments](https://owlmetry.com/docs/concepts/attachments)
- **Cross-app session investigation** — one endpoint reconstructs the full timeline across all apps a user touched during an incident window
- **User feedback** — free-text feedback from apps (Swift SDK `OwlFeedbackView` / `Owl.sendFeedback`) or from your own frontend (Node SDK `Owl.sendFeedback`). Kanban board with status lifecycle, comments, and session-linked event replay. See [docs/concepts/feedback](https://owlmetry.com/docs/concepts/feedback)

### Analytics
- **Structured metrics** — define metrics, track operations with `startOperation`/`complete`/`fail`, query aggregations (counts, success rates, duration percentiles, error breakdowns) via API
- **Funnel analytics** — define conversion funnels and let your agent query drop-off rates programmatically
- **User properties** — attach custom key-value metadata to users (subscription status, plan tier, revenue) from SDKs or integrations; filter the Users list by billing tier (paid / trial / free)

### Integrations
- **Third-party integrations** — per-project connections with a provider registry. Supports:
  - **RevenueCat** — subscription status, revenue, entitlements, trial vs paid, cancelled trials, billing period — synced via webhooks and on-demand API sync
  - **Apple Search Ads** — OAuth integration with Apple's Campaign Management API resolves captured ASA IDs into human-readable names (`asa_campaign_name`, `asa_ad_group_name`, `asa_keyword`, `asa_ad_name`) for every attributed user. Test-connection via `/api/v5/acls`, backfill job for existing users
- **Apple Search Ads attribution** — Swift SDK captures AAAttribution tokens on `Owl.configure()`, server resolves them against Apple's public Attribution API and writes numeric IDs (`attribution_source`, `asa_campaign_id`, `asa_ad_group_id`, etc.); the Apple Search Ads integration above resolves those to names. Pending retries handled across launches; organic/ASA badges visible on user rows

### Agent and human interfaces
- **Agent-native API** — every operation available through `owl_agent_` keys: query events, investigate sessions, read issues, download attachments, drive integrations
- **MCP server** — Streamable HTTP endpoint exposing the full product surface as tools (55+), plus SDK integration guides as resources; agents connect directly with an `owl_agent_` key
- **CLI for agents and humans** — `--format json` for machine consumption, `--format table` for humans. Same tool, both audiences
- **AI skill files** — bundled with the CLI npm package, teach any coding agent (Claude Code, Codex, etc.) how to set up, instrument, and query OwlMetry
- **Dashboard optional** — Next.js web UI for when you want a visual overview. Not required for any workflow

### Platform and operations
- **Auth model** — `owl_client_` keys for SDKs, `owl_agent_` keys for agents/CLI/MCP, `owl_import_` keys for bulk history, JWT (passwordless email code) for the optional dashboard. Role-based access: **owner** > **admin** > **member**
- **Team management** — create teams, invite members by email (7-day token expiry), change roles, remove members
- **Audit trail** — automatic logging of who created, updated, or deleted resources; queryable via API, CLI, and dashboard
- **Background jobs** — generic job system on pg-boss with cron scheduling, progress tracking, cooperative cancellation, and email alerts. Manages data syncs, issue scanning, issue digests, retention cleanup, and database maintenance with full visibility via dashboard, CLI, and API
- **Per-project retention** — configurable `retention_days_events`, `retention_days_metrics`, `retention_days_funnels` columns enforced by a daily job
- **Database auto-pruning** — optional size limit (`MAX_DATABASE_SIZE_GB`) safety net; drops oldest monthly partitions first
- **Data mode** — every event is tagged `production` / `development`; dashboard sidebar toggles which you're looking at
- **Single Postgres** — one database, one API server. Monthly partitioned events, metrics, and funnels handle the scale. Postgres does what it's been doing reliably for decades

## Architecture

```
apps/server        Fastify API server (port 4000) — the core of OwlMetry
apps/cli           CLI for agents and humans (agent key auth)
apps/web           Next.js dashboard + Fumadocs documentation site (port 3000)
sdks/swift         Swift SDK (Swift Package) — iOS, iPadOS, macOS
sdks/node          Node.js Server SDK (zero runtime dependencies)
packages/shared    Shared TypeScript types and constants
packages/db        Drizzle ORM schema, migrations, seed, partition utilities
skills/            AI skill files (bundled into the CLI npm package)
demos/ios          iOS demo app
demos/node         Node.js demo server
deploy/            VPS deployment scripts (Ubuntu 24.04)
```

The API server is the product. Everything else — the dashboard, the CLI, the MCP server, the SDKs — is a client of that API. This means your agent has the same capabilities as the web UI. Nothing is dashboard-only.

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
pnpm test              # Vitest + Swift SDK + Node SDK + CLI integration tests
pnpm test:swift-sdk    # Swift SDK integration tests only
pnpm test:node-sdk     # Node SDK integration tests only
pnpm test:cli          # CLI tests (unit + formatter + integration)
pnpm test:coverage     # Server tests with code coverage reporting
```

## Self-Hosting

See the [self-hosting guide](https://owlmetry.com/docs/self-hosting) for the full walkthrough — covers system dependencies, PostgreSQL, nginx, pm2, SSL, Cloudflare, firewall, attachments storage, and maintenance.

## Documentation

Full documentation is available at [owlmetry.com/docs](https://owlmetry.com/docs):

- **[API Reference](https://owlmetry.com/docs/api-reference)** — complete REST API with request/response examples
- **[CLI](https://owlmetry.com/docs/cli)** — command reference for agents and humans
- **[MCP](https://owlmetry.com/docs/mcp)** — setup and tool reference for MCP clients
- **[Node.js SDK](https://owlmetry.com/docs/sdks/node)** — server-side instrumentation (`npm install @owlmetry/node`)
- **[Swift SDK](https://owlmetry.com/docs/sdks/swift)** — iOS, iPadOS, and macOS instrumentation (Swift Package)
- **[Concepts](https://owlmetry.com/docs/concepts)** — events, issues, feedback, attachments, metrics, funnels, experiments, integrations, and more
- **[Self-Hosting](https://owlmetry.com/docs/self-hosting)** — VPS setup, nginx, pm2, SSL, environment variables

## Links

- [Website](https://owlmetry.com)
- [Documentation](https://owlmetry.com/docs)
- [Self-Hosting Guide](https://owlmetry.com/docs/self-hosting)
- [CLI on npm](https://www.npmjs.com/package/@owlmetry/cli)
- [Node SDK on npm](https://www.npmjs.com/package/@owlmetry/node)
