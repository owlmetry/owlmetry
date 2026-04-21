#!/usr/bin/env bash
set -euo pipefail

# End-to-end test: starts the server against owlmetry_test, runs CLI integration tests

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PID=""
TEST_PORT=4113
TEST_DB="postgres://localhost:5432/owlmetry_test"
TEST_DB_NAME="owlmetry_test"
TEST_AGENT_KEY="owl_agent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
TEST_CLI_AGENT_KEY="owl_agent_ffffffffffffffffffffffffffffffffffffffffffffffff"

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

# Create a full-permission agent key for CLI integration tests
TEAM_ID=$(psql -tA "$TEST_DB_NAME" -c "SELECT id FROM teams LIMIT 1")
OWNER_ID=$(psql -tA "$TEST_DB_NAME" -c "SELECT user_id FROM team_members WHERE team_id = '$TEAM_ID' AND role = 'owner' LIMIT 1")

EXISTING_CLI_KEY=$(psql -tA "$TEST_DB_NAME" -c "SELECT id FROM api_keys WHERE secret = '$TEST_CLI_AGENT_KEY' LIMIT 1")
PERMS='["events:read","apps:read","apps:write","projects:read","projects:write","metrics:read","metrics:write","funnels:read","funnels:write","audit_logs:read","feedback:read","feedback:write"]'
if [ -z "$EXISTING_CLI_KEY" ]; then
    echo "Creating full-permission CLI agent key..."
    psql -tA "$TEST_DB_NAME" <<SQL
INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
VALUES ('$TEST_CLI_AGENT_KEY', 'agent', NULL, '$TEAM_ID', 'CLI Test Agent Key', '$OWNER_ID',
  '$PERMS'::jsonb);
SQL
    echo "CLI agent key seeded"
else
    echo "CLI agent key exists — refreshing permissions"
    psql -tA "$TEST_DB_NAME" -c "UPDATE api_keys SET permissions = '$PERMS'::jsonb WHERE secret = '$TEST_CLI_AGENT_KEY'"
fi

# Ingest a few test events so queries have data
TEST_CLIENT_KEY="owl_client_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
APP_ID=$(psql -tA "$TEST_DB_NAME" -c "SELECT id FROM apps WHERE platform = 'apple' LIMIT 1")

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

# Ingest test events
echo "=== Ingesting test events ==="
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
curl -sf -X POST "http://127.0.0.1:$TEST_PORT/v1/ingest" \
  -H "Authorization: Bearer $TEST_CLIENT_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"bundle_id\":\"com.owlmetry.test\",\"events\":[
    {\"message\":\"CLI test event info\",\"level\":\"info\",\"timestamp\":\"$TIMESTAMP\",\"session_id\":\"00000000-0000-0000-0000-000000000099\"},
    {\"message\":\"CLI test event error\",\"level\":\"error\",\"timestamp\":\"$TIMESTAMP\",\"session_id\":\"00000000-0000-0000-0000-000000000099\"}
  ]}" > /dev/null

echo "Events ingested"

echo "=== Running CLI integration tests ==="
cd "$ROOT_DIR/apps/cli"
OWLMETRY_TEST_ENDPOINT="http://127.0.0.1:$TEST_PORT" \
OWLMETRY_TEST_AGENT_KEY="$TEST_CLI_AGENT_KEY" \
OWLMETRY_TEST_TEAM_ID="$TEAM_ID" \
OWLMETRY_TEST_APP_ID="$APP_ID" \
    npx vitest run src/__tests__/integration/ --test-timeout 15000 2>&1

echo "=== CLI integration tests passed ==="
