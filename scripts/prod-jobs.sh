#!/usr/bin/env bash
# Show recent system job runs (team_id IS NULL) from the local database.
# Designed to run directly on the production VPS.
set -euo pipefail

# Source .env if DATABASE_URL isn't already set
if [ -z "${DATABASE_URL:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  ENV_FILE="$SCRIPT_DIR/../.env"
  if [ -f "$ENV_FILE" ]; then
    export $(grep -E '^DATABASE_URL=' "$ENV_FILE" | xargs)
  fi
fi

DB_URL="${DATABASE_URL:?DATABASE_URL must be set (provide it or add to .env)}"

psql "$DB_URL" -c "
SELECT
  job_type,
  status,
  triggered_by,
  to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS started_utc,
  to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS completed_utc,
  CASE
    WHEN started_at IS NOT NULL AND completed_at IS NOT NULL
    THEN (EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::int || 'ms'
    ELSE '-'
  END AS duration,
  COALESCE(error, '') AS error
FROM job_runs
WHERE team_id IS NULL
ORDER BY created_at DESC
LIMIT 20;
"
