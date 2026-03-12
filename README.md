# OwlMetry

Self-hosted observability for the agentic development era. Ship your app, collect real usage data, and feed it directly to your AI coding agent — so it can see what's actually happening in production and fix things autonomously.

Most AI-assisted development is a one-way street: you vibe-code a feature, ship it, and hope for the best. OwlMetry closes the loop. It gives your agent eyes on real user behavior, crash patterns, and performance bottlenecks — turning "build and forget" into a continuous feedback cycle where your agent can make informed decisions based on what's actually happening in the wild.

> **Warning:** This project is in active development and is not yet production-ready. APIs, schemas, and configuration may change without notice.

## Features

- **Event ingestion** — batch ingest up to 100 events per request with deduplication; supports gzip-compressed payloads
- **Projects & apps** — organize apps by product across platforms (e.g., "MyApp" project contains iOS + Android apps)
- **Device tracking** — platform, OS version, app version, device model, locale, build number
- **Anonymous identity** — SDKs generate `owl_anon_` IDs; `/v1/identity/claim` retroactively links anonymous events to a known user
- **Bundle ID validation** — client API keys are scoped to an app's registered bundle ID, validated on every ingest request
- **Funnel analytics** — define funnels retroactively from event data
- **Auth model** — JWT for users, `owl_client_` keys for SDKs (write-only), `owl_agent_` keys for agents/CLI (read-only)
- **Monthly partitioned events** — auto-creates PostgreSQL partitions for high-volume event storage
- **Database auto-pruning** — optional size limit (`MAX_DATABASE_SIZE_GB`); drops oldest partitions first

## Architecture

```
packages/shared    Shared TypeScript types and constants
packages/db        Drizzle ORM schema, migrations, seed
apps/server        Fastify API server (port 4000)
apps/web           Next.js dashboard (port 3000) — coming soon
apps/cli           CLI tool — coming soon
sdks/swift         Swift SDK (Swift Package)
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
| `POST` | `/v1/auth/login` | None | Get JWT token |
| `POST` | `/v1/auth/keys` | JWT | Generate API key |
| `POST` | `/v1/ingest` | Client key | Batch ingest events |
| `GET` | `/v1/events` | Agent key / JWT | Query events with filters |
| `GET` | `/v1/events/:id` | Agent key / JWT | Get single event |
| `GET` | `/v1/projects` | JWT | List projects |
| `GET` | `/v1/projects/:id` | JWT | Get project with apps |
| `POST` | `/v1/projects` | JWT | Create project |
| `GET` | `/v1/apps` | JWT | List apps |
| `POST` | `/v1/apps` | JWT | Create app (requires project_id) |
| `POST` | `/v1/identity/claim` | Client key | Link anonymous events to a user ID |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://localhost:5432/owlmetry` | PostgreSQL connection string |
| `JWT_SECRET` | `dev-secret-change-me` | Secret for signing JWTs |
| `PORT` | `4000` | API server port |
| `HOST` | `0.0.0.0` | API server bind address |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `MAX_DATABASE_SIZE_GB` | `0` (disabled) | Max database size before pruning old events |
