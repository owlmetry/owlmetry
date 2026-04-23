#!/usr/bin/env bash
# OwlMetry VPS Setup Script
# Installs: Node.js 22 LTS, PostgreSQL 16, nginx, pm2, pnpm
# Target: Ubuntu 24.04 LTS
# Usage: bash setup-vps.sh
#
# This script is idempotent — safe to run multiple times.

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# --- Preflight checks ---
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root"
fi

source /etc/os-release
if [[ "$VERSION_ID" != "24.04" ]]; then
  warn "This script is tested on Ubuntu 24.04. You're running $VERSION_ID — proceed with caution."
fi

echo ""
echo "=============================="
echo "  OwlMetry VPS Setup"
echo "=============================="
echo ""

# --- System update ---
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# --- Swap (2 GB — needed for Next.js builds on small VPS) ---
if swapon --show | grep -q /swapfile; then
  log "Swap already configured"
else
  log "Creating 2 GB swap file..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "Swap enabled (2 GB)"
fi

# --- Node.js 22 LTS (via NodeSource) ---
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  log "Node.js already installed: $NODE_VER"
else
  log "Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
  log "Node.js installed: $(node --version)"
fi

# --- pnpm ---
if command -v pnpm &>/dev/null; then
  log "pnpm already installed: $(pnpm --version)"
else
  log "Installing pnpm..."
  npm install -g pnpm
  log "pnpm installed: $(pnpm --version)"
fi

# --- pm2 ---
if command -v pm2 &>/dev/null; then
  log "pm2 already installed: $(pm2 --version)"
else
  log "Installing pm2..."
  npm install -g pm2
  log "pm2 installed: $(pm2 --version)"
fi

# --- PostgreSQL 16 ---
if command -v psql &>/dev/null; then
  PG_VER=$(psql --version | grep -oP '\d+\.\d+')
  log "PostgreSQL already installed: $PG_VER"
else
  log "Installing PostgreSQL 16..."
  apt-get install -y -qq postgresql postgresql-contrib
  log "PostgreSQL installed: $(psql --version)"
fi

# Ensure PostgreSQL is running
if systemctl is-active --quiet postgresql; then
  log "PostgreSQL is running"
else
  log "Starting PostgreSQL..."
  systemctl start postgresql
  systemctl enable postgresql
fi

# --- Create owlmetry database and user ---
DB_NAME="owlmetry"
DB_USER="owlmetry"
DB_PASS=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)

if sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  log "Database '$DB_NAME' already exists"
else
  log "Creating database user and database..."
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || warn "User '$DB_USER' may already exist"
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
  log "Database '$DB_NAME' created (user: $DB_USER)"

  # Save credentials for .env generation
  GENERATED_DB_PASS="$DB_PASS"
fi

# --- nginx ---
if command -v nginx &>/dev/null; then
  log "nginx already installed: $(nginx -v 2>&1 | grep -oP '[\d.]+')"
else
  log "Installing nginx..."
  apt-get install -y -qq nginx
  log "nginx installed"
fi

# Ensure nginx is running
if systemctl is-active --quiet nginx; then
  log "nginx is running"
else
  log "Starting nginx..."
  systemctl start nginx
  systemctl enable nginx
fi

# --- Git (should be preinstalled on Ubuntu, but just in case) ---
if command -v git &>/dev/null; then
  log "git already installed: $(git --version)"
else
  log "Installing git..."
  apt-get install -y -qq git
  log "git installed"
fi

# --- Create app directory ---
APP_DIR="/opt/owlmetry"
if [[ -d "$APP_DIR" ]]; then
  log "App directory $APP_DIR already exists"
else
  log "Creating app directory: $APP_DIR"
  mkdir -p "$APP_DIR"
fi

# --- Setup pm2 to start on boot ---
log "Configuring pm2 startup..."
pm2 startup systemd -u root --hp /root --no-interactive 2>/dev/null || true

# --- Summary ---
echo ""
echo "=============================="
echo "  Setup Complete"
echo "=============================="
echo ""
echo "  Node.js:     $(node --version)"
echo "  pnpm:        $(pnpm --version)"
echo "  pm2:         $(pm2 --version)"
echo "  PostgreSQL:  $(psql --version | grep -oP '\d+\.\d+')"
echo "  nginx:       $(nginx -v 2>&1 | grep -oP '[\d.]+')"
echo "  git:         $(git --version | grep -oP '[\d.]+')"
echo ""
echo "  App directory: $APP_DIR"
echo "  Database:      $DB_NAME"
echo "  DB User:       $DB_USER"

if [[ -n "${GENERATED_DB_PASS:-}" ]]; then
  echo ""
  echo "  ┌──────────────────────────────────────────────┐"
  echo "  │  DATABASE_URL (save this for .env):           │"
  echo "  │  postgresql://$DB_USER:$GENERATED_DB_PASS@localhost:5432/$DB_NAME"
  echo "  └──────────────────────────────────────────────┘"
  echo ""
  warn "Save the DATABASE_URL above — the password won't be shown again."
fi

echo ""
log "Next steps:"
echo "  1. Clone the repo into $APP_DIR"
echo "  2. Create .env from .env.example"
echo "  3. pnpm install && NODE_OPTIONS='--max-old-space-size=1024' pnpm build && pnpm db:migrate && pnpm dev:seed"
echo "     (NODE_OPTIONS bumps the heap above Next.js's needs — without it the web build OOMs on a ~1 GiB droplet)"
echo "  4. Configure nginx and pm2"
echo ""
