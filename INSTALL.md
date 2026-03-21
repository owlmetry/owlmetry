# Self-Hosting OwlMetry

Complete guide to running OwlMetry on your own Ubuntu VPS. By the end you'll have:

- API server at `api.yourdomain.com`
- Ingest endpoint at `ingest.yourdomain.com`
- Web dashboard at `yourdomain.com`

Estimated time: 15–20 minutes.

## Requirements

- Ubuntu 24.04 LTS VPS (1 GB RAM minimum, 25 GB disk recommended)
- A domain pointed to the VPS (3 A records: root, `api`, `ingest`)
- SSH access to the server

## 1. System Dependencies

The setup script installs Node.js 22, PostgreSQL 16, nginx, pm2, pnpm, and creates the database.

```bash
# On the VPS as root
curl -fsSL https://raw.githubusercontent.com/Jasonvdb/owlmetry/main/deploy/setup-ubuntu-vps.sh -o setup-ubuntu-vps.sh
bash setup-ubuntu-vps.sh
```

**Save the `DATABASE_URL` printed at the end** — you'll need it in step 3.

The script is idempotent — safe to run again if interrupted.

## 2. Clone and Build

```bash
cd /opt/owlmetry
git clone https://github.com/Jasonvdb/owlmetry.git .
pnpm install
pnpm build
```

## 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
DATABASE_URL=postgresql://owlmetry:<password>@localhost:5432/owlmetry
JWT_SECRET=<random-64-char-string>
PORT=4000
HOST=0.0.0.0
CORS_ORIGINS=https://yourdomain.com
MAX_DATABASE_SIZE_GB=8
RESEND_API_KEY=<your-resend-key>
EMAIL_FROM=noreply@yourdomain.com
```

Generate a random JWT secret:

```bash
openssl rand -base64 48
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (from setup script output) |
| `JWT_SECRET` | Yes | Random string for signing JWTs — generate with `openssl rand -base64 48` |
| `PORT` | No | API server port (default: `4000`) |
| `HOST` | No | Bind address (default: `0.0.0.0`) |
| `CORS_ORIGINS` | Yes | Your dashboard URL (e.g., `https://yourdomain.com`) |
| `MAX_DATABASE_SIZE_GB` | No | Auto-prune events when DB exceeds this size (default: `0` = disabled) |
| `RESEND_API_KEY` | No | [Resend](https://resend.com) API key for sending verification emails. If unset, codes print to server console (fine for single-user setups) |
| `EMAIL_FROM` | No | From address for verification emails (default: `noreply@owlmetry.com`) |

## 4. Run Migrations

```bash
pnpm db:migrate
```

This creates all tables and event partitions. Your first user account will be auto-created when you log in via the dashboard or CLI.

> **Dev/testing only:** Run `pnpm dev:seed` to create a demo user, project, app, and deterministic API keys. Do **not** run this in production — the seed keys are committed to git and publicly known.

## 5. Configure nginx

Create the nginx config:

```bash
cat > /etc/nginx/sites-available/owlmetry << 'NGINX'
# OwlMetry API (agent keys, dashboard API, auth)
server {
    listen 80;
    server_name api.yourdomain.com;

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

# OwlMetry Ingest (SDK client keys)
server {
    listen 80;
    server_name ingest.yourdomain.com;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# OwlMetry Web Dashboard
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
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
NGINX
```

Enable and test:

```bash
ln -sf /etc/nginx/sites-available/owlmetry /etc/nginx/sites-enabled/owlmetry
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

## 6. Start Services with pm2

Create the pm2 ecosystem file:

```bash
cat > /opt/owlmetry/ecosystem.config.cjs << 'PM2'
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
    {
      name: "owlmetry-web",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/opt/owlmetry/apps/web",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
PM2
```

Start and persist:

```bash
cd /opt/owlmetry
pm2 start ecosystem.config.cjs
pm2 save
```

Verify both services are running:

```bash
pm2 status
```

You should see `owlmetry-api` and `owlmetry-web` both with status `online`.

## 7. SSL (optional — skip if using Cloudflare)

If you're using Cloudflare in proxy mode (orange cloud), Cloudflare handles SSL termination and you can skip this step. nginx only needs to listen on port 80.

If you're **not** using Cloudflare:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com -d api.yourdomain.com -d ingest.yourdomain.com
```

## 8. Verify

Test the API:

```bash
curl -s http://localhost:4000/health
# Should return: {"status":"ok"}
```

Test nginx routing:

```bash
# From a machine that can reach the server
curl -s https://api.yourdomain.com/health
curl -s https://ingest.yourdomain.com/health
```

Open `https://yourdomain.com` in a browser to see the dashboard.

## Cloudflare Setup (Recommended)

If using Cloudflare for DDoS protection and CDN:

1. Add your domain to Cloudflare
2. Create 3 A records pointing to your VPS IP, all with **Proxy enabled** (orange cloud):
   - `@` (root) → VPS IP
   - `api` → VPS IP
   - `ingest` → VPS IP
3. SSL/TLS mode: **Full** (not Full Strict, since we're not using certbot)
4. Lock down the VPS firewall to only accept HTTP/HTTPS from [Cloudflare IPs](https://www.cloudflare.com/ips/)

## Updating

Pull the latest code and rebuild:

```bash
cd /opt/owlmetry
git pull
pnpm install
pnpm build
pnpm db:migrate
pm2 restart all
```

## Firewall (Recommended)

Restrict access to SSH via Tailscale and HTTP/HTTPS via Cloudflare:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0 to any port 22 proto tcp

# Allow Cloudflare IPs only
for cidr in $(curl -s https://www.cloudflare.com/ips-v4/); do
  ufw allow from "$cidr" to any port 80,443 proto tcp
done
for cidr in $(curl -s https://www.cloudflare.com/ips-v6/); do
  ufw allow from "$cidr" to any port 80,443 proto tcp
done

ufw --force enable
```

## Database Maintenance

- **Partitions** are auto-created on server startup (current month + 2 months ahead)
- **Auto-pruning** runs hourly when `MAX_DATABASE_SIZE_GB` is set — drops oldest monthly partitions first
- **Backups**: `pg_dump owlmetry > backup.sql`
- **Size check**: `psql -c "SELECT pg_size_pretty(pg_database_size('owlmetry'));"`

## Troubleshooting

```bash
# Check service logs
pm2 logs owlmetry-api --lines 50
pm2 logs owlmetry-web --lines 50

# Check nginx config
nginx -t

# Check database connectivity
psql $DATABASE_URL -c "SELECT 1;"

# Check disk space
df -h

# Restart services
pm2 restart all
```
