#!/usr/bin/env bash
set -euo pipefail

# End-to-end test: starts the server against owlmetry_test, runs Swift SDK integration tests

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PID=""
TEST_PORT=4111
TEST_DB="postgres://localhost:5432/owlmetry_test"

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

echo "=== Running Swift SDK integration tests ==="
cd "$ROOT_DIR/sdks/swift"
OWLMETRY_TEST_ENDPOINT="http://127.0.0.1:$TEST_PORT" \
    swift test --filter SDKIntegrationTests 2>&1

echo "=== SDK integration tests passed ==="
