# OwlMetry

Self-hosted observability for the agentic development era. Ship your app, collect real usage data, and feed it directly to your AI coding agent — so it can see what's actually happening in production and fix things autonomously.

Most AI-assisted development is a one-way street: you vibe-code a feature, ship it, and hope for the best. OwlMetry closes the loop. It gives your agent eyes on real user behavior, crash patterns, and performance bottlenecks — turning "build and forget" into a continuous feedback cycle where your agent can make informed decisions based on what's actually happening in the wild.

> **Warning:** This project is in active development and is not yet production-ready. APIs, schemas, and configuration may change without notice.

## Features

- **Event ingestion** — batch ingest up to 100 events per request with deduplication; supports gzip-compressed payloads
- **Projects & apps** — organize apps by product across platforms (`apple`, `android`, `web`, `backend`); Apple platform covers iOS, iPadOS, and macOS with a single app
- **Device tracking** — environment (runtime platform: ios/ipados/macos/android/web/backend), OS version, app version, device model, locale, build number
- **Anonymous identity** — SDKs generate `owl_anon_` IDs; `/v1/identity/claim` retroactively links anonymous events to a known user
- **Bundle ID validation** — client API keys are scoped to an app's registered bundle ID, validated on every ingest request
- **Funnel analytics** — planned but not yet implemented (database tables exist, API routes and UI coming later)
- **Auth model** — identity-only JWT for users (multi-team support, no extra headers needed), `owl_client_` keys for SDKs (client and server), `owl_agent_` keys for agents/CLI. Role-based access: **owner** (full control), **admin** (manage resources and members), **member** (read-only)
- **Team management** — create teams, invite members by email, change roles, remove members
- **Monthly partitioned events** — auto-creates PostgreSQL partitions for high-volume event storage
- **Database auto-pruning** — optional size limit (`MAX_DATABASE_SIZE_GB`); drops oldest partitions first

## Architecture

```
packages/shared    Shared TypeScript types and constants
packages/db        Drizzle ORM schema, migrations, seed
apps/server        Fastify API server (port 4000)
apps/web           Next.js dashboard (port 3000) — coming soon
apps/cli           CLI tool (agent key)
sdks/swift         Swift SDK (Swift Package)
sdks/node          Node.js Server SDK (zero dependencies)
demos/ios          iOS demo app for testing Swift SDK
```

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
| `POST` | `/v1/auth/register` | None | Create user + team |
| `POST` | `/v1/auth/login` | None | Get JWT token + teams list |
| `GET` | `/v1/auth/me` | JWT | Get current user profile + teams |
| `PATCH` | `/v1/auth/me` | JWT | Update name or password |
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

The CLI is a pure HTTP client for the OwlMetry API, designed for both humans and AI agents.

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

- `--format table` (default) — human-readable tables
- `--format json` — machine-readable JSON
- `--format log` — color-coded log lines (best for events)

## Node.js Server SDK

The Node.js SDK (`@owlmetry/node`) lets you log server-side events into the same OwlMetry pipeline as your client events. Zero runtime dependencies.

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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://localhost:5432/owlmetry` | PostgreSQL connection string |
| `JWT_SECRET` | `dev-secret-change-me` | Secret for signing JWTs |
| `PORT` | `4000` | API server port |
| `HOST` | `0.0.0.0` | API server bind address |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `MAX_DATABASE_SIZE_GB` | `0` (disabled) | Max database size before pruning old events |
