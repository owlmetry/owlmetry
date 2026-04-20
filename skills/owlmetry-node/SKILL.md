---
name: owlmetry-node
version: 0.1.17
description: >-
  Integrate the OwlMetry Node.js SDK into a backend service for server-side
  analytics, event tracking, metrics, funnels, and A/B experiments. Use when
  instrumenting a Node.js, Express, Fastify, or serverless project with OwlMetry.
allowed-tools: Read, Bash, Grep, Glob
---

## What is OwlMetry?

OwlMetry is a self-hosted analytics platform. The Node.js SDK captures events from backend services — API servers, job workers, serverless functions — and delivers them to the OwlMetry server. It buffers events in memory and flushes them in batches to avoid blocking your application's request path.

The SDK has zero runtime dependencies. All calls are non-blocking — events are buffered internally and sent in the background. A single `Owl.configure()` call initialises everything including a background flush timer.

## Version Check

Run these checks silently. Only inform the user if updates are available.

1. **Skill version**: `curl -sf https://raw.githubusercontent.com/Jasonvdb/owlmetry/main/skills/owlmetry-node/SKILL.md | head -5` — compare the remote `version:` field to this file's `version:` frontmatter above. If the remote version is newer, ask the user if they want to update.
2. **SDK version**: `npm ls @owlmetry/node --json 2>/dev/null` for current version, `npm view @owlmetry/node version 2>/dev/null` for latest. If newer, offer `npm install @owlmetry/node@latest`.

## Prerequisite

You need an **ingest endpoint** and a **client key** (`owl_client_...`) for a backend app. Both come from the CLI setup flow.

If the user doesn't have these yet, follow the `/owlmetry-cli` skill first — it handles sign-up, project creation, and app creation. The ingest endpoint is saved to `~/.owlmetry/config.json` (`ingest_endpoint` field) and the client key is returned when creating an app.

> **Any time you need to run an `owlmetry` CLI command** (querying events, creating metrics/funnels, listing apps, etc.), **load the `/owlmetry-cli` skill first**. Do not guess CLI syntax — it has non-obvious subcommand patterns and flags.

## Install

```bash
npm install @owlmetry/node
```

Zero runtime dependencies. Node.js 20+. ESM only.

## Configure

Place `Owl.configure()` in the **main entry point** of your service — the root `index.ts`, `server.ts`, or `app.ts` file where your server starts. It must run once at process startup, before any other `Owl` calls. Do **not** put it in a helper/utility file — it should be alongside your other top-level initialization (e.g., `express()`, `Fastify()`, Firebase `setGlobalOptions`).

```typescript
import { Owl } from '@owlmetry/node';

Owl.configure({
  endpoint: 'https://ingest.owlmetry.com',
  apiKey: 'owl_client_...',
  serviceName: 'my-api',          // optional, default: "unknown"
  appVersion: '1.2.0',            // optional
  isDev: false,                   // optional, default: process.env.NODE_ENV !== "production"
  flushIntervalMs: 5000,          // optional, default: 5000
  flushThreshold: 20,             // optional, default: 20
  maxBufferSize: 10000,           // optional, default: 10000
  consoleLogging: true,           // optional, default: true — print events to console
});
```

- `apiKey` must start with `owl_client_`
- `isDev` defaults to `true` when `NODE_ENV !== "production"`
- Generates a fresh `sessionId` (UUID) on each `configure()` call. This is the process-wide default; per-request overrides are available via `Owl.withSession(sessionId)` (returns a `ScopedOwl`) or the `options.sessionId` parameter on `info/debug/warn/error`. Use them to link backend events to the session of the client that triggered them
- Registers a `beforeExit` handler to auto-flush on graceful shutdown

**Serverless (Firebase Cloud Functions, AWS Lambda, Vercel):** After adding `Owl.configure()`, also wrap your exported handler functions with `Owl.wrapHandler()` to guarantee events are flushed before the runtime freezes. This is essential boilerplate for serverless — without it, buffered events are lost:

```typescript
// AWS Lambda / generic serverless:
export const handler = Owl.wrapHandler(async (event, context) => { ... });

// Firebase Cloud Functions v2:
// IMPORTANT: Explicitly type the request parameter — TypeScript cannot infer
// the CallableRequest type through wrapHandler's generics.
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';

export const myFunction = onCall(
  Owl.wrapHandler(async (request: CallableRequest) => {
    const { data, auth } = request;  // works — TypeScript knows the type
    // ...
  })
);
```

**TypeScript note:** `wrapHandler()` uses generic rest parameters (`<TArgs extends unknown[]>`), which means TypeScript sometimes infers handler parameters as `unknown` when the outer function (like Firebase's `onCall`) expects a specific callback type. If you see type errors like `Property 'data' does not exist on type 'unknown'`, explicitly annotate the handler's parameters (e.g., `request: CallableRequest`, `event: APIGatewayEvent`).

## Next Steps — Codebase Instrumentation

Once `Owl.configure()` is in place and the project builds successfully, **you MUST stop here and ask the user** which area they'd like to instrument first — even if the user's original prompt asked you to "instrument the app." Do not proceed with any code changes until the user chooses. Present these three options:

1. **Event & error logging** — Audit the codebase for request handlers, error paths, background jobs, and key operations. Add `Owl.info()`, `Owl.warn()`, `Owl.error()` calls at meaningful points throughout the service. This is SDK-only — no CLI setup required beyond what's already done.
2. **Structured metrics** — Identify operations worth measuring (API response times, database queries, external service calls, etc.). Add `Owl.startOperation()` / `Owl.recordMetric()` to track durations and success rates. **Requires CLI first:** each metric slug must be defined on the server via `owlmetry metrics create` (use the `/owlmetry-cli` skill) before the SDK can emit events for it.
3. **Funnel tracking** — Identify server-side user journeys (sign-up flow, payment processing, onboarding steps). Add `Owl.step()` calls at each step to measure drop-off. **Requires CLI first:** the funnel definition (with steps and event filters) must be created via `owlmetry funnels create` (use the `/owlmetry-cli` skill) before tracking makes sense.

After the user chooses, do a thorough audit of the entire codebase to find all relevant locations, then present a summary of proposed changes before making any edits.

## Buffering and Delivery

The SDK buffers events in memory and sends them to the server in batches. Understanding how buffering works helps you avoid lost events:

- **Buffer size** (`maxBufferSize: 10000`): maximum events held in memory. If the buffer fills up, new events are dropped. Increase this if your service produces bursts of events.
- **Flush interval** (`flushIntervalMs: 5000`): a background timer fires every 5 seconds and sends all buffered events. The timer uses `.unref()` so it won't keep the process alive.
- **Flush threshold** (`flushThreshold: 20`): if the buffer reaches this many events before the timer fires, an immediate flush is triggered.
- **HTTP timeout**: each flush request has a 10-second timeout to prevent hanging on slow or unreachable servers. Failed flushes are silently dropped (events are not retried).
- **Graceful exit**: a `beforeExit` handler auto-flushes remaining events on normal process termination. For SIGTERM/SIGINT, you must call `Owl.shutdown()` explicitly (see Graceful Shutdown).

The key implication: if your process crashes or is force-killed, any events still in the buffer are lost. For critical routes, use `wrapHandler()` to flush after each request.

## Log Events

Events are the core data unit. Use the four log levels to capture different kinds of backend activity:

- **`info`** — normal operations: server started, request handled, job completed, user action processed.
- **`debug`** — verbose detail for development: cache lookups, query plans, config loading, intermediate state.
- **`warn`** — something didn't go as expected but the process can continue: failed validation, precondition checks that fail, slow queries, rate limits approaching, fallback paths, deprecated API usage, missing optional config.
- **`error`** — a caught exception or hard failure inside a `try`/`catch`: database connection errors, external API timeouts, unhandled rejections, file system errors. Reserve for actual thrown errors, not for anticipated validation outcomes.

Choose **message strings** that are specific and searchable. Prefer `"Payment processing failed"` over `"error occurred"`. Use attributes for structured data you'll filter on later.

```typescript
Owl.info('Server started', { port: 4000 });
Owl.debug('Cache miss', { key: 'user:123' });
Owl.warn('Invalid request payload', { field: 'email', reason: 'missing' });

try {
  await db.connect();
} catch (err) {
  Owl.error('Database connection failed', { host: 'db.example.com', error: String(err) });
}
```

All methods: `Owl.info/debug/warn/error(message, attrs?, options?)`. The third `options` argument supports `{ attachments }` for uploading files alongside the event — see *File Attachments* below.

Source module (file:line) is auto-captured from the call stack.

**Backend-specific examples:**
```typescript
Owl.info('Request handled', { method: 'POST', path: '/api/orders', status: 201 });
Owl.info('Background job completed', { job: 'send-emails', processed: 150 });
Owl.warn('Rate limit approaching', { current: 95, limit: 100, client_id: 'abc' });

try {
  await stripe.charges.create(params);
} catch (err) {
  Owl.error('Stripe charge failed', { endpoint: '/charges', error: String(err) });
}
```

## File Attachments (use sparingly)

When an error's root cause is bound up in a file the server received — a PDF that failed to parse, an upload that failed to decode, a model file that failed to load — you can attach the file to the error event so an engineer can download it from the dashboard, CLI, or MCP and reproduce locally.

```typescript
try {
  await PdfParser.parse(inputPath);
} catch (err) {
  Owl.error('pdf parse failed', { error: String(err) }, {
    attachments: [
      { path: inputPath, name: 'input.pdf' },                               // from disk
      { buffer: diagnosticsJson, name: 'debug.json', contentType: 'application/json' }, // in memory
    ],
  });
}
```

**Attachments are a limited resource.** Each project has a storage quota (default **5 GB**) and each end-user has their own bucket within that project (default **250 MB per user**; reservations without a user_id are bounded only by the project ceiling). Before adding `attachments:` anywhere, make sure the file's bytes are *essential* to reproduce the bug. Good candidates:

- ✅ A parse failure on a user-uploaded document whose bytes you cannot reconstruct.
- ✅ A ML model file that fails to load — the bytes themselves are the suspect.
- ✅ A fixture-like artefact that reveals the bug when inspected.

Bad candidates — do not attach:

- ❌ Every error. Most backend failures are well-described by `attrs`.
- ❌ Data you can reconstruct from the request (URLs, IDs, small config).
- ❌ Large files that are downloaded rather than user-supplied — include the source URL.
- ❌ Logs or stack traces. Put them in `attrs` or stream them separately.

Uploads are strictly non-fatal: network errors and quota rejections (`user_quota_exhausted`, `quota_exhausted`) are logged (when `debug: true`) but the event still posts normally. Uploads use `fetch` and run on a serial queue so a 200 MB file never blocks event batching. `Owl.flush()` and `Owl.shutdown()` await pending uploads, so `wrapHandler()` and explicit flushes in serverless handlers deliver attachments before the runtime freezes. Attachments are not queued offline — if the process is killed without reaching `flush()`/`shutdown()`/`beforeExit`, the attachment is lost but the event is not.

## Per-Request User Scoping

In a multi-user backend, many requests are processed concurrently. Without scoping, you'd need to pass a user ID to every log call. `Owl.withUser()` creates a scoped instance that automatically tags all events with the user ID — create one per request in your auth middleware.

Use scoped instances whenever you know who the user is. Use the global `Owl` for system-level events (startup, shutdown, background jobs without a user context).

```typescript
const owl = Owl.withUser('user_42');
owl.info('User logged in');
owl.warn('Rate limit approaching', { requests: 95 });
owl.error('Payment failed', { reason: 'insufficient_funds' });
```

`ScopedOwl` has the same logging methods as `Owl` (`info`, `debug`, `warn`, `error`, `track`, `startOperation`, `recordMetric`).

## Per-Request Session Scoping (Cross-SDK Correlation)

By default, the Node SDK stamps every event with one session ID generated at `configure()`. For a server handling many clients, that default is almost never what you want — you'd like backend events to share the client's session ID so you can see client + server activity together in one session view.

`Owl.withSession(sessionId)` returns a `ScopedOwl` that overrides the session ID on every event it emits. It's chainable with `withUser()` in either order:

```typescript
const owl = Owl.withSession(clientSessionId).withUser(userId);
owl.info('Request received', { path: req.url });
```

The typical pattern: have the client propagate its session ID via an HTTP header, then scope the request. Swift clients expose `Owl.sessionId` publicly for exactly this purpose.

```typescript
// Fastify
app.addHook('onRequest', async (request) => {
  const clientSessionId = request.headers['x-owl-session-id'] as string | undefined;
  const base = request.user?.id ? Owl.withUser(request.user.id) : Owl;
  request.owl = clientSessionId ? base.withSession(clientSessionId) : base;
});
```

```swift
// Swift client
var request = URLRequest(url: apiURL)
if let sessionId = Owl.sessionId {
    request.setValue(sessionId, forHTTPHeaderField: "X-Owl-Session-Id")
}
```

For callers that can't scope, `info/debug/warn/error` also accept a per-call `sessionId` in their options object:

```typescript
Owl.info('Webhook received', { provider: 'stripe' }, { sessionId: clientSessionId });
```

Precedence: per-call `options.sessionId` > scope `withSession(...)` > default process session ID.

Session IDs should be UUID strings (the Swift SDK's `Owl.sessionId` already is). Non-UUID values passed to `withSession()` or `options.sessionId` are silently ignored — the event falls back to the SDK's default session ID. This means a malformed or missing client header will never crash a request handler. Invalid values are logged via `console.error` only when `debug: true` is set on configure.

## Funnel Tracking

Backend funnels track server-side conversion flows — signup pipelines, payment processing, onboarding sequences, data processing stages. Unlike client-side funnels where users interact with UI, backend funnels typically track state transitions in response to API calls or background jobs.

**User ID is critical for backend funnels.** Funnel analytics group by user to calculate conversion — without a user ID, events can't be attributed. Always use a scoped instance (`Owl.withUser()`) or ensure user identity is set.

```typescript
Owl.step('signup-started');
Owl.step('email-verified', { method: 'link' });
Owl.step('profile-completed');

// With user scoping:
const owl = Owl.withUser(userId);
owl.step('checkout-completed', { item_count: '3' });
```

The step name you pass to `step()` must match the `step_name` in the funnel definition's `event_filter`. For example, if the step filter is `{"step_name": "signup-started"}`, then call `Owl.step('signup-started')`. Define matching funnels via `/owlmetry-cli`.

**Note:** `step()` attributes must be `Record<string, string>` (string values only).

## Structured Metrics

Use structured metrics when you want aggregated performance data (averages, percentiles, error rates) rather than individual event logs. Metrics give you trend data and alerting signals; events give you individual records for debugging.

**Decision: lifecycle vs single-shot:**
- **Lifecycle** — when measuring something with a duration (start → end). Backend examples: HTTP request handling, database queries, external API calls, file processing, queue job execution.
- **Single-shot** — when recording a point-in-time measurement. Backend examples: queue depth, cache hit rate, active connections, deployment markers.

The metric definition must exist on the server **before** the SDK emits events for that slug. Create it via CLI first.

### Lifecycle operations (start -> complete/fail/cancel)

```typescript
const op = Owl.startOperation('database-query', { table: 'users' });
try {
  const result = await db.query('SELECT * FROM users');
  op.complete({ rows: result.length });
} catch (err) {
  op.fail(String(err), { table: 'users' });
}

// Or cancel:
op.cancel({ reason: 'timeout' });
```

`duration_ms` and `tracking_id` (UUID) are auto-added. Create the metric definition first:
```bash
owlmetry metrics create --project-id <id> --name "Database Query" --slug database-query --lifecycle --format json
```

### Single-shot measurements

```typescript
Owl.recordMetric('cache-hit-rate', { rate: '0.95', cache: 'redis' });
```

Works with scoped instances too: `owl.startOperation(...)`, `owl.recordMetric(...)`.

**Slug rules:** lowercase letters, numbers, hyphens only. Invalid slugs are auto-corrected with a warning.

## A/B Experiments

Backend experiments let you vary server-side behavior (algorithm versions, feature flags, response formats) and measure the impact through metrics and funnels.

How it works end-to-end:
1. **Assign a variant**: `getVariant("pricing-algo", ["control", "v2"])` randomly picks on first call.
2. **Branch your logic**: use the returned variant string to execute different code paths.
3. **Events are auto-tagged**: all subsequent events include the experiment assignment.
4. **Analyse**: query metrics or funnels segmented by variant to compare outcomes.

Assignments persist to `~/.owlmetry/experiments.json` on disk, so they survive restarts. **Serverless caveat**: in serverless environments (Lambda, Cloud Functions), each cold start reads from the file — but if the filesystem is ephemeral, assignments won't persist across invocations. Use `setExperiment()` with a server-side assignment for stable bucketing in serverless.

```typescript
// Random assignment on first call, persisted to ~/.owlmetry/experiments.json
const variant = Owl.getVariant('checkout-redesign', ['control', 'variant-a', 'variant-b']);

// Force-set (e.g., from server config)
Owl.setExperiment('checkout-redesign', 'variant-a');

// Clear all
Owl.clearExperiments();
```

All events automatically include an `experiments` field with current assignments.

## User Properties

Attach custom key-value metadata to users. Properties are merged server-side — existing keys not in your call are preserved.

```typescript
// With explicit user ID
Owl.setUserProperties('user_123', { plan: 'premium', org: 'acme' });

// With scoped instance
const owl = Owl.withUser('user_123');
owl.setUserProperties({ plan: 'premium', org: 'acme' });
```

Set a value to `""` to delete a key. All values must be strings. Max 50 properties per user, 50-char keys, 200-char values.

Use for user-level data that changes infrequently (subscription status, plan tier, company). For event-specific data, use custom attributes on events instead.

**RevenueCat integration prompt** — copy-paste to set up subscription tracking:

```
Connect RevenueCat to my OwlMetry project so I can see paid vs free users:

1. Use `/owlmetry-cli` to add the RevenueCat integration with my RC V2 secret API key
   (needs Customer information → Read only AND Project configuration → Read only at the section level, everything else No access).
2. Show me the webhook setup values from the output so I can paste them into RevenueCat.
3. After I confirm the webhook is live, run a bulk sync to backfill existing subscribers.
4. Add Owl.setUserProperties() calls in my Node.js webhook handler or purchase
   callback so the dashboard updates immediately when a user subscribes, without
   waiting for RevenueCat's webhook.
```

## Serverless Support

Serverless environments (AWS Lambda, Vercel Functions, Cloud Functions) freeze the runtime after each invocation. Events still in the buffer are lost when the runtime freezes — the flush timer and `beforeExit` handler may never fire.

`wrapHandler()` solves this by calling `Owl.flush()` in a `finally` block after every invocation, guaranteeing delivery before the runtime freezes.

**When to use `wrapHandler()`:**
- **Serverless functions**: always wrap — this is the only reliable way to flush.
- **Long-running servers, critical routes**: wrap routes where losing events is unacceptable (payment processing, user signup). The 5-second flush timer handles the rest.
- **Long-running servers, general routes**: not needed — the background timer and shutdown handler cover normal operation.

```typescript
// AWS Lambda
export const handler = Owl.wrapHandler(async (event, context) => {
  Owl.info('Lambda invoked', { functionName: context.functionName });
  // ... handle request ...
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
});

// Express route
app.post('/api/checkout', Owl.wrapHandler(async (req, res) => {
  const owl = Owl.withUser(req.user?.id);
  const op = owl.startOperation('checkout');
  // ... process ...
  op.complete();
  res.json({ ok: true });
}));
```

`wrapHandler` calls `Owl.flush()` in a `finally` block, ensuring events are sent even if the handler throws.

## Graceful Shutdown

Without explicit shutdown, events buffered since the last flush (up to 5 seconds worth) are lost when the process exits via SIGTERM or SIGINT. The `beforeExit` handler only covers graceful exits (no pending work, no signal termination).

Always add a shutdown handler for production services:

```typescript
process.on('SIGTERM', async () => {
  await Owl.shutdown();
  process.exit(0);
});
```

- `shutdown()` stops the flush timer, flushes remaining events, and clears state.
- The `beforeExit` handler auto-flushes on graceful process exit even without explicit shutdown.

## Integration Patterns

These patterns show how to wire OwlMetry into common Node.js frameworks. The key ideas:
- **Create a scoped logger in auth middleware** so all route handlers get user-attributed events automatically.
- **Use `wrapHandler()` on critical routes** where losing events is unacceptable.
- **Call `shutdown()` in the framework's close hook** to flush on process termination.

### Express middleware

```typescript
import express from 'express';
import { Owl } from '@owlmetry/node';

const app = express();

// Scoped logging middleware
app.use((req, res, next) => {
  req.owl = req.user?.id ? Owl.withUser(req.user.id) : Owl;
  next();
});

app.post('/api/order', Owl.wrapHandler(async (req, res) => {
  const op = req.owl.startOperation('create-order', { items: req.body.items?.length });
  try {
    const order = await createOrder(req.body);
    op.complete({ order_id: order.id });
    res.json(order);
  } catch (err) {
    op.fail(String(err));
    res.status(500).json({ error: 'Order failed' });
  }
}));

process.on('SIGTERM', async () => {
  await Owl.shutdown();
  process.exit(0);
});
```

### Fastify hooks

```typescript
import Fastify from 'fastify';
import { Owl } from '@owlmetry/node';

const fastify = Fastify();

fastify.addHook('onRequest', (request, reply, done) => {
  request.owl = request.user?.id ? Owl.withUser(request.user.id) : Owl;
  done();
});

fastify.addHook('onClose', async () => {
  await Owl.shutdown();
});

fastify.post('/api/process', async (request, reply) => {
  request.owl.info('Processing request', { path: request.url });
  // ... handle request ...
  await Owl.flush();
  return { ok: true };
});
```

## Instrumentation Strategy

When instrumenting a backend service, follow this priority:

**Always instrument (events — no CLI setup needed):**
- Server startup and shutdown (`info`)
- Request handling: key route hits, responses sent (`info` with method/path/status)
- Caught exceptions: catch blocks, unhandled rejections, external API failures (`error`)
- Validation failures and pre-checks: bad input, missing optional config, rate limits (`warn`)
- Authentication events: login, logout, token refresh (`info`)
- Core business actions: order placed, payment processed, email sent (`info`)
- Background jobs: started, completed, failed (`info`/`error`)

**Instrument when relevant (metrics — requires CLI `owlmetry metrics create` first):**
- Lifecycle metrics for operations where duration matters: API response time, database queries, external service calls, file processing
- Single-shot metrics for point-in-time values: queue depth, cache hit rate, active connections

**Instrument when relevant (funnels — requires CLI `owlmetry funnels create` first):**
- Multi-step server-side flows you want to measure conversion on: signup pipeline, payment processing, onboarding sequence
- Always use `Owl.withUser()` for funnel events — funnel analytics require user IDs to calculate conversion

**What NOT to instrument:**
- PII (emails, passwords, tokens, IP addresses)
- High-frequency health checks or heartbeats
- Every database query (instrument categories, not every call)
- Sensitive business data (payment amounts, account balances)
