# OwlMetry Full Demo Test Guide

Step-by-step guide for setting up, running, and verifying the full OwlMetry demo stack. Designed so an AI agent (or human) can follow it end-to-end.

## Phase 1: Prerequisites

Verify these tools are available:

```bash
node --version       # v18+
pnpm --version       # v8+
psql --version       # PostgreSQL 15+
```

If using UI automation for the iOS app, ensure `xcodebuildmcp` is available:

```bash
xcodebuildmcp --help
```

## Phase 2: Database & Build Setup

```bash
# Create database if it doesn't exist (safe to run if it already exists)
createdb owlmetry 2>/dev/null || true

# Install dependencies and build all packages
pnpm install && pnpm build

# Run migrations (creates partitioned events table)
pnpm db:migrate

# Seed dev data (admin user, team, project, apps, API keys)
pnpm db:seed
```

### Seed credentials

- **Dashboard login**: `admin@owlmetry.com` / `H00tH00t`
- **Agent API key**: `owl_agent_demo_000000000000000000000000000000000000000000`
- **Server client key**: `owl_client_svr_0000000000000000000000000000000000000000`

## Phase 3: Start Servers

Kill any stale processes, then start the API server and Node demo server:

```bash
# Kill stale processes
lsof -ti:4000 | xargs kill 2>/dev/null || true
lsof -ti:4007 | xargs kill 2>/dev/null || true

# Terminal 1 — OwlMetry API server (port 4000)
pnpm dev:server

# Terminal 2 — Node.js demo server (port 4007, requires API server)
pnpm dev:demo-node
```

### Health checks

Wait for both servers to show "Listening" / "Ready", then verify:

```bash
curl -s http://localhost:4000/health | jq .   # {"status":"ok"}
curl -s http://localhost:4007/health | jq .   # {"status":"ok"}
```

## Phase 4: Configure CLI

```bash
node apps/cli/dist/index.js setup \
  --endpoint http://localhost:4000 \
  --api-key owl_agent_demo_000000000000000000000000000000000000000000
```

Verify it works:

```bash
node apps/cli/dist/index.js projects
```

Expected: a table showing "Demo Project".

## Phase 5: Build & Launch iOS App

### Find a simulator

```bash
xcrun simctl list devices available | grep iPhone
```

Pick a device (e.g., "iPhone 16") and note its UDID.

### Using xcodebuildmcp (recommended for agents)

```bash
# List simulators
xcodebuildmcp simulator list

# Build and run
xcodebuildmcp simulator build-and-run \
  --scheme OwlMetryDemo \
  --project-path demos/ios/OwlMetryDemo.xcodeproj \
  --simulator-id <UDID>
```

### Using xcodebuild (manual)

```bash
xcodebuild -project demos/ios/OwlMetryDemo.xcodeproj \
  -scheme OwlMetryDemo \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -quiet

xcrun simctl boot <UDID>
open -a Simulator
xcrun simctl install <UDID> <path-to-built-.app>
xcrun simctl launch <UDID> dev.owlmetry.demo
```

## Phase 6: Tap "Run Full Demo"

The "Full Demo" section is at the top of the app's form. Tap the **"Run Full Demo"** button.

### Using xcodebuildmcp UI automation

```bash
# Take a snapshot to find the button
xcodebuildmcp snapshot-ui --simulator-id <UDID>

# Tap the button (coordinates from snapshot)
xcodebuildmcp tap --simulator-id <UDID> --x <X> --y <Y>

# Wait for events to flush (SDK auto-flushes every 5s, wrapHandler flushes immediately)
sleep 10

# Verify — screenshot should show "Full Demo Complete" in event log
xcodebuildmcp screenshot --simulator-id <UDID>
```

### What the button does

1. Sends `Owl.info("Demo started")` (iOS)
2. Sends `Owl.tracking("demo_full_test")` (iOS)
3. Calls `POST /api/greet` with `name: "OwlBot"` → 2 backend info events
4. Waits 1 second
5. Calls `POST /api/checkout` with `item: "Premium Plan"` → backend info + warn + error
6. Sends `Owl.error("Simulated client crash")` (iOS)

## Phase 7: Verify Events

### List all recent events

```bash
node apps/cli/dist/index.js events --since 5m --format log
```

**Expected: 8 events** across 2 apps:

| # | App | Level | Message |
|---|-----|-------|---------|
| 1 | iOS Demo App | info | Demo started |
| 2 | iOS Demo App | tracking | demo_full_test |
| 3 | Backend Demo API Server | info | Greeting requested |
| 4 | Backend Demo API Server | info | Greeting sent |
| 5 | Backend Demo API Server | info | Checkout started |
| 6 | Backend Demo API Server | warn | Payment gateway timeout |
| 7 | Backend Demo API Server | error | Checkout failed: payment provider unreachable |
| 8 | iOS Demo App | error | Simulated client crash |

Note: iOS events may take up to 5 seconds to appear (SDK flush interval). Backend events flush immediately via `wrapHandler`.

### Filter for errors only

```bash
node apps/cli/dist/index.js events --level error --since 5m --format json
```

Expected: 2 error events — "Checkout failed: payment provider unreachable" and "Simulated client crash".

## Phase 8: Debug Workflow

This simulates how you'd investigate errors in production.

### Step 1: Find the errors

```bash
node apps/cli/dist/index.js events --level error --since 5m --format json
```

Note the event IDs from the output.

### Step 2: Inspect the checkout error

```bash
# View full event details
node apps/cli/dist/index.js events view <CHECKOUT_ERROR_ID> --format json
```

Look at the custom attributes — you'll see `item: "Premium Plan"`.

### Step 3: Investigate surrounding events

```bash
node apps/cli/dist/index.js investigate <CHECKOUT_ERROR_ID> --window 5
```

This shows events within 5 minutes of the error. You should see the **warn → error chain**:

1. `info` — "Checkout started" (the operation began)
2. `warn` — "Payment gateway timeout" (first sign of trouble)
3. `error` — "Checkout failed: payment provider unreachable" (the failure)

This pattern is typical: a warning precedes the error, giving you context about *why* it failed.

### Step 4: Investigate the iOS error

```bash
node apps/cli/dist/index.js investigate <IOS_ERROR_ID> --window 5
```

You should see the full demo sequence from the iOS app's perspective:

1. `info` — "Demo started"
2. `tracking` — "demo_full_test"
3. `error` — "Simulated client crash"

## Phase 9: Cleanup

```bash
# Kill servers
lsof -ti:4000 | xargs kill 2>/dev/null || true
lsof -ti:4007 | xargs kill 2>/dev/null || true

# Terminate iOS app on simulator
xcrun simctl terminate <UDID> dev.owlmetry.demo
```

## Troubleshooting

### No events showing up

- Check both servers are running: `curl http://localhost:4000/health && curl http://localhost:4007/health`
- iOS SDK events flush every 5 seconds — wait at least 10 seconds after tapping
- Backend events flush immediately via `wrapHandler` but need the API server to be reachable

### Fewer than 8 events

- If missing iOS events (3): the SDK may not have flushed yet, wait longer
- If missing backend events (5): check the Node demo server logs for connection errors to port 4000
- The `demo_app_opened` tracking event fires on app launch — this is separate from the full demo and not counted in the 8

### CLI shows no results

- Verify CLI is configured: `cat ~/.owlmetry/config.json`
- Verify the agent key works: `node apps/cli/dist/index.js projects`
- Try a wider time range: `--since 30m`
