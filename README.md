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
- **Funnel analytics** — define conversion funnels and let your agent query drop-off rates programmatically
- **Dashboard optional** — Next.js web UI for when you want a visual overview. Not required for any workflow
- **Single Postgres** — no Kafka, no ClickHouse, no Redis. One database. Monthly partitioned events handle the scale
- **Auth model** — `owl_client_` keys for SDKs, `owl_agent_` keys for agents/CLI, JWT for the optional dashboard. Role-based access: **owner** > **admin** > **member**
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
```

The API server is the product. Everything else — the dashboard, the CLI, the SDKs — is a client of that API. This means your agent has the same capabilities as the web UI. Nothing is dashboard-only.

## Requirements

- Node.js >= 20
- PostgreSQL >= 15
- pnpm

## Local Development

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
pnpm db:seed

# Start the API server
pnpm dev:server

# Run tests (requires owlmetry_test database + Swift toolchain)
createdb owlmetry_test
pnpm test              # Vitest + Swift SDK integration tests
pnpm test:swift-sdk    # Swift SDK integration tests only
pnpm test:node-sdk     # Node SDK integration tests only
```

## Server Installation (Ubuntu VPS)

### 1. System dependencies

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm
corepack enable
corepack prepare pnpm@latest --activate

# PostgreSQL
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql

# pm2 (process manager)
npm install -g pm2

# nginx
sudo apt install -y nginx
```

### 2. PostgreSQL setup

```bash
sudo -u postgres createuser --superuser $(whoami)
createdb owlmetry
```

### 3. Application setup

```bash
git clone <your-repo-url> /opt/owlmetry
cd /opt/owlmetry

pnpm install
pnpm build

cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgres://localhost:5432/owlmetry
#   JWT_SECRET=<generate a random 64-char string>
#   PORT=4000
#   CORS_ORIGINS=https://your-domain.com

pnpm db:migrate
pnpm db:seed
```

### 4. pm2 process management

Create `ecosystem.config.cjs` in the project root:

```js
module.exports = {
  apps: [
    {
      name: "owlmetry-api",
      script: "apps/server/dist/index.js",
      cwd: "/opt/owlmetry",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
```

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # follow the instructions to enable on boot
```

### 5. nginx reverse proxy

```nginx
# /etc/nginx/sites-available/owlmetry
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/owlmetry /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 6. SSL with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.your-domain.com
```

### 7. Partition maintenance

Event partitions are auto-created on server startup (current month + 2 months ahead). If you want a safety net, add a monthly cron:

```bash
crontab -e
# Add: run migrations on the 1st of each month at midnight
0 0 1 * * cd /opt/owlmetry && pnpm db:migrate >> /var/log/owlmetry-partitions.log 2>&1
```

### 8. Database size management

To prevent the database from filling your disk, set `MAX_DATABASE_SIZE_GB` in `.env`. The server checks the total database size every hour (and once at startup). When the limit is exceeded, it drops the oldest monthly event partitions first. If only the current month remains and the database is still over the limit, it falls back to deleting the oldest individual event rows. Set to `0` (default) to disable.

```bash
MAX_DATABASE_SIZE_GB=10
```

## API Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | None | Health check |
| `POST` | `/v1/auth/send-code` | None | Send email verification code |
| `POST` | `/v1/auth/verify-code` | None | Verify code and get JWT token |
| `GET` | `/v1/auth/me` | JWT | Get current user profile + teams |
| `PATCH` | `/v1/auth/me` | JWT | Update name |
| `GET` | `/v1/auth/teams` | JWT | List user's teams |
| `GET` | `/v1/auth/keys` | JWT | List API keys for user's teams |
| `GET` | `/v1/auth/keys/:id` | JWT | Get single API key metadata |
| `POST` | `/v1/auth/keys` | JWT (admin+) | Generate API key |
| `PATCH` | `/v1/auth/keys/:id` | JWT (admin+) | Update API key name or permissions |
| `DELETE` | `/v1/auth/keys/:id` | JWT (admin+) | Revoke an API key |
| `POST` | `/v1/teams` | JWT | Create a new team |
| `GET` | `/v1/teams/:id` | JWT | Get team details with members |
| `PATCH` | `/v1/teams/:id` | JWT (admin+) | Rename team |
| `DELETE` | `/v1/teams/:id` | JWT (owner) | Delete team |
| `GET` | `/v1/teams/:id/members` | JWT | List team members |
| `POST` | `/v1/teams/:id/members` | JWT (admin+) | Add member by email |
| `PATCH` | `/v1/teams/:id/members/:userId` | JWT (admin+) | Change member role |
| `DELETE` | `/v1/teams/:id/members/:userId` | JWT (admin+) | Remove member (or self-leave) |
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
| `POST` | `/v1/identity/claim` | Client key | Link anonymous events to a user ID |

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

### Usage

```bash
# An agent can do all of this programmatically
owlmetry projects                              # List projects
owlmetry projects view <id>                    # Project details with apps
owlmetry projects create --team-id <id> --name "My Project" --slug my-project

owlmetry apps                                  # List apps
owlmetry apps --project <id>                   # Filter by project
owlmetry apps create --project <id> --name "iOS App" --platform apple --bundle-id com.example.app

owlmetry events --since 1h                     # Events from the last hour
owlmetry events --level error --app <id>       # Errors for a specific app
owlmetry events view <id>                      # Full event details
owlmetry investigate <eventId> --window 10     # Events ±10 min around target
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
  endpoint: 'https://your-owlmetry.com',
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

Owl.configure({ endpoint: 'https://...', apiKey: 'owl_client_...' });

export const myFunction = onRequest(
  Owl.wrapHandler(async (req, res) => {
    Owl.info('Function invoked', { path: req.path });
    res.send('OK');
  }),
);
```

- **Safety net**: The SDK also registers a `beforeExit` hook that flushes any remaining events when the Node.js event loop drains, catching events that slip through without `wrapHandler`.
- **Use `wrapHandler`, not `shutdown()`** — `shutdown()` destroys the transport, which breaks warm container reuse. `wrapHandler` only flushes, keeping the SDK ready for the next invocation.

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
| `MAX_DATABASE_SIZE_GB` | `0` (disabled) | Max database size before pruning old events |
| `RESEND_API_KEY` | (empty) | Resend API key for sending verification emails; if unset, codes print to server console |
| `EMAIL_FROM` | `noreply@owlmetry.com` | From address for verification emails (requires Resend) |
