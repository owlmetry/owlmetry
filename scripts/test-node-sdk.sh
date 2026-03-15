#!/usr/bin/env bash
set -euo pipefail

# End-to-end test: starts the server against owlmetry_test, runs Node SDK integration tests

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PID=""
TEST_PORT=4112
TEST_DB="postgres://localhost:5432/owlmetry_test"
TEST_DB_NAME="owlmetry_test"
TEST_SERVER_KEY="owl_server_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
TEST_AGENT_KEY="owl_agent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

cleanup() {
    if [ -n "$SERVER_PID" ]; then
        echo "Stopping test server (pid $SERVER_PID)..."
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

echo "=== Building packages ==="
cd "$ROOT_DIR"
pnpm build

echo "=== Seeding test database ==="
cd "$ROOT_DIR/apps/server"
./node_modules/.bin/tsx "$ROOT_DIR/scripts/seed-test-db.mts"

# Seed server app via psql (avoids module resolution issues)
SERVER_KEY_HASH=$(node -e "const{createHash}=require('crypto');console.log(createHash('sha256').update('$TEST_SERVER_KEY').digest('hex'))")
SERVER_KEY_PREFIX=$(echo "$TEST_SERVER_KEY" | cut -c1-16)
TEAM_ID=$(psql -tA "$TEST_DB_NAME" -c "SELECT id FROM teams LIMIT 1")
PROJECT_ID=$(psql -tA "$TEST_DB_NAME" -c "SELECT id FROM projects LIMIT 1")
EXISTING=$(psql -tA "$TEST_DB_NAME" -c "SELECT id FROM apps WHERE platform = 'server' LIMIT 1")

if [ -z "$EXISTING" ]; then
    echo "Creating test server app..."
    psql -tA "$TEST_DB_NAME" <<SQL
DO \$\$
DECLARE
  v_app_id uuid;
BEGIN
  INSERT INTO apps (team_id, project_id, name, platform, bundle_id, client_key)
  VALUES ('$TEAM_ID', '$PROJECT_ID', 'Test Server App', 'server', NULL, '$TEST_SERVER_KEY')
  RETURNING id INTO v_app_id;

  INSERT INTO api_keys (key_hash, key_prefix, key_type, app_id, team_id, name, permissions)
  VALUES ('$SERVER_KEY_HASH', '$SERVER_KEY_PREFIX', 'server', v_app_id, '$TEAM_ID', 'Test Server Key', '["events:write"]'::jsonb);
END \$\$;
SQL
    echo "Server app seeded"
else
    echo "Server app already exists"
fi

echo "=== Starting test server on port $TEST_PORT ==="
DATABASE_URL="$TEST_DB" \
PORT="$TEST_PORT" \
JWT_SECRET="test-secret" \
HOST="127.0.0.1" \
    ./node_modules/.bin/tsx "$ROOT_DIR/apps/server/src/index.ts" &
SERVER_PID=$!

# Wait for server to be ready
echo "Waiting for server..."
for i in $(seq 1 20); do
    if curl -sf "http://127.0.0.1:$TEST_PORT/health" > /dev/null 2>&1; then
        echo "Server ready"
        break
    fi
    if [ "$i" -eq 20 ]; then
        echo "Server failed to start"
        exit 1
    fi
    sleep 0.5
done

echo "=== Building Node SDK ==="
cd "$ROOT_DIR/sdks/node"
npx tsc

echo "=== Running Node SDK integration tests ==="
OWLMETRY_TEST_ENDPOINT="http://127.0.0.1:$TEST_PORT" \
OWLMETRY_TEST_SERVER_KEY="$TEST_SERVER_KEY" \
OWLMETRY_TEST_AGENT_KEY="$TEST_AGENT_KEY" \
    node --test dist/tests/integration/*.test.js 2>&1

echo "=== Node SDK integration tests passed ==="
