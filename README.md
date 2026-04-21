# OwlMetry

Agent-first observability. One Postgres instance. No humans required.

OwlMetry is a self-hosted observability platform designed for the agentic development era. Point your coding agent at the setup instructions, and it handles everything — integration, monitoring, debugging, performance analysis. The developer doesn't need to open a dashboard, configure alerts, or interpret charts. The agent does it all through the CLI.

> **⚠️ Alpha Software** — OwlMetry is in early alpha. APIs, schemas, and configuration may change without notice. Not yet production-ready.

## Get Started

### Option A — MCP (recommended for AI agents)

Add the OwlMetry MCP server to your agent's config. It exposes 51 tools and SDK integration guides as resources — no CLI install needed. See the [MCP setup docs](https://owlmetry.com/docs/mcp) for editor-specific instructions.

### Option B — CLI

```bash
npm install -g @owlmetry/cli
```

Then tell your agent to run `owlmetry skills` and install the relevant skill files. It handles the rest — account setup, SDK integration, instrumentation, and querying.

## Why agent-first?

Most observability tools are built for humans staring at dashboards. OwlMetry is built for agents making API calls. Every feature is accessible programmatically through agent API keys, a CLI, and a complete REST API. The web dashboard exists as an optional visual layer — not the primary interface.

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
- **MCP server** — Streamable HTTP endpoint exposing 51 tools and SDK integration guides as resources; agents connect directly with an `owl_agent_` key — no CLI install needed
- **AI skill files** — bundled with the CLI, teach any coding agent (Claude Code, Codex, etc.) how to set up, instrument, and query OwlMetry
- **Event ingestion** — batch ingest up to 100 events per request with deduplication; supports gzip-compressed payloads
- **Projects & apps** — organize apps by product across platforms (`apple`, `android`, `web`, `backend`); Apple platform covers iOS, iPadOS, and macOS with a single app
- **Device tracking** — environment, OS version, app version, device model, locale, build number
- **Anonymous identity** — SDKs generate `owl_anon_` IDs; `/v1/identity/claim` retroactively links anonymous events to a known user
- **Bundle ID validation** — client API keys are scoped to an app's registered bundle ID, validated on every ingest request
- **Structured metrics** — define metrics, track operations with `startOperation`/`complete`/`fail`, query aggregations (counts, success rates, duration percentiles, error breakdowns) via API
- **Funnel analytics** — define conversion funnels and let your agent query drop-off rates programmatically
- **Lightweight A/B experiments** — SDKs assign random variants on first call, persist assignments locally, and tag all events with the active experiment; no server config needed
- **User properties** — attach custom key-value metadata to users (subscription status, plan tier, revenue) from SDKs or third-party integrations; visible in the Users list
- **Event attachments** — SDKs can upload files (logs, screenshots, crash dumps) alongside error events; stored on disk, linked to events and issues, downloadable via dashboard, CLI, and MCP. See [docs/concepts/attachments](https://owlmetry.com/docs/concepts/attachments)
- **User feedback** — free-text feedback captured from apps via the Swift SDK's `OwlFeedbackView`/`Owl.sendFeedback`, or forwarded from your own frontend via the Node SDK's `Owl.sendFeedback`. Surfaces in a kanban with status lifecycle, comments, and session-linked event replay. See [docs/concepts/feedback](https://owlmetry.com/docs/concepts/feedback)
- **Third-party integrations** — connect services like RevenueCat to sync subscription data into user properties via webhooks and on-demand API sync; per-project config with provider registry and validation
- **Audit trail** — automatic logging of who created, updated, or deleted resources; queryable via API, CLI, and dashboard
- **Dashboard optional** — Next.js web UI for when you want a visual overview. Not required for any workflow
- **Single Postgres** — no Kafka, no ClickHouse, no Redis. One database. Monthly partitioned events handle the scale
- **Auth model** — `owl_client_` keys for SDKs, `owl_agent_` keys for agents/CLI, JWT for the optional dashboard. Role-based access: **owner** > **admin** > **member**
- **Team invitations** — token-based email invitations with 7-day expiry; public accept page handles auth redirects automatically
- **Team management** — create teams, invite members by email, change roles, remove members
- **Background jobs** — generic job system with cron scheduling, progress tracking, cooperative cancellation, and email alerts. Manages data syncs, database maintenance, and scheduled cleanup with full visibility via dashboard, CLI, and API
- **Database auto-pruning** — optional size limit (`MAX_DATABASE_SIZE_GB`); runs as a scheduled background job, drops oldest partitions first

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

See the [self-hosting guide](https://owlmetry.com/docs/self-hosting) for the full walkthrough — covers system dependencies, PostgreSQL, nginx, pm2, SSL, Cloudflare, firewall, and maintenance.

## Documentation

Full documentation is available at [owlmetry.com/docs](https://owlmetry.com/docs):

- **[API Reference](https://owlmetry.com/docs/api-reference)** — complete REST API with request/response examples
- **[CLI](https://owlmetry.com/docs/cli)** — command reference for agents and humans
- **[Node.js SDK](https://owlmetry.com/docs/sdks/node)** — server-side instrumentation (`npm install @owlmetry/node`)
- **[Swift SDK](https://owlmetry.com/docs/sdks/swift)** — iOS, iPadOS, and macOS instrumentation (Swift Package)
- **[Concepts](https://owlmetry.com/docs/concepts)** — events, metrics, funnels, experiments, auth, and more
- **[Self-Hosting](https://owlmetry.com/docs/self-hosting)** — VPS setup, nginx, pm2, SSL, environment variables

## Links

- [Website](https://owlmetry.com)
- [Documentation](https://owlmetry.com/docs)
- [Self-Hosting Guide](https://owlmetry.com/docs/self-hosting)
- [CLI on npm](https://www.npmjs.com/package/@owlmetry/cli)
- [Node SDK on npm](https://www.npmjs.com/package/@owlmetry/node)
