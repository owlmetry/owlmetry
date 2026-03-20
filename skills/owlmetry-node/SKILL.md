---
name: owlmetry-node
version: 0.1.0
description: >-
  Integrate the OwlMetry Node.js SDK into a backend service for server-side
  analytics, event tracking, metrics, funnels, and A/B experiments. Use when
  instrumenting a Node.js, Express, Fastify, or serverless project with OwlMetry.
allowed-tools: Read, Bash, Grep, Glob
---

## Version Check

Run these checks silently. Only inform the user if updates are available.

1. **Skill version**: `curl -sf https://raw.githubusercontent.com/Jasonvdb/owlmetry/main/skills/owlmetry-node/SKILL.md | head -5` — compare the `version:` field to `0.1.0`. If newer, ask the user if they want to update.
2. **SDK version**: `npm ls @owlmetry/node --json 2>/dev/null` for current version, `npm view @owlmetry/node version 2>/dev/null` for latest. If newer, offer `npm install @owlmetry/node@latest`.

## Prerequisite

You need an OwlMetry endpoint URL and a `client_key` (starts with `owl_client_...`) for an app with `platform: backend`.

If the user doesn't have these yet, invoke `/owlmetry-cli` first to:
1. Sign up or log in
2. Create a project (if needed)
3. Create an app with `--platform backend` (no `--bundle-id` needed)
4. Note the `client_key` from the app creation response

## Install

```bash
npm install @owlmetry/node
```

Zero runtime dependencies. Node.js 20+. Supports both ESM and CommonJS.

## Configure

```typescript
import { Owl } from '@owlmetry/node';

Owl.configure({
  endpoint: 'https://api.owlmetry.com',
  apiKey: 'owl_client_...',
  serviceName: 'my-api',          // optional, default: "unknown"
  appVersion: '1.2.0',            // optional
  isDebug: false,                 // optional, default: process.env.NODE_ENV !== "production"
  flushIntervalMs: 5000,          // optional, default: 5000
  flushThreshold: 20,             // optional, default: 20
  maxBufferSize: 10000,           // optional, default: 10000
});
```

- `apiKey` must start with `owl_client_`
- `isDebug` defaults to `true` when `NODE_ENV !== "production"`
- Generates a fresh `sessionId` (UUID) on each `configure()` call
- Registers a `beforeExit` handler to auto-flush on graceful shutdown

## Log Events

```typescript
Owl.info('Server started', { port: 4000 });
Owl.debug('Cache miss', { key: 'user:123' });
Owl.warn('Slow query', { duration_ms: 2500, table: 'events' });
Owl.error('Database connection failed', { host: 'db.example.com' });
```

All methods: `Owl.info/debug/warn/error(message: string, attrs?: Record<string, unknown>)`.

Source module (file:line) is auto-captured from the call stack.

## Per-Request User Scoping

Create a scoped logger that automatically tags all events with a user ID:

```typescript
const owl = Owl.withUser('user_42');
owl.info('User logged in');
owl.warn('Rate limit approaching', { requests: 95 });
owl.error('Payment failed', { reason: 'insufficient_funds' });
```

`ScopedOwl` has the same logging methods as `Owl` (`info`, `debug`, `warn`, `error`, `track`, `startOperation`, `recordMetric`).

## Funnel Tracking

```typescript
Owl.track('signup-started');
Owl.track('email-verified', { method: 'link' });
Owl.track('profile-completed');

// With user scoping:
const owl = Owl.withUser(userId);
owl.track('checkout-completed', { item_count: '3' });
```

Each `track()` call emits an info-level event with message `"track:<stepName>"`. Define matching funnels via `/owlmetry-cli`.

**Note:** `track()` attributes must be `Record<string, string>` (string values only).

## Structured Metrics

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
owlmetry metrics create --project <id> --name "Database Query" --slug database-query --lifecycle --format json
```

### Single-shot measurements

```typescript
Owl.recordMetric('cache-hit-rate', { rate: '0.95', cache: 'redis' });
```

Works with scoped instances too: `owl.startOperation(...)`, `owl.recordMetric(...)`.

**Slug rules:** lowercase letters, numbers, hyphens only. Invalid slugs are auto-corrected with a warning.

## A/B Experiments

```typescript
// Random assignment on first call, persisted to ~/.owlmetry/experiments.json
const variant = Owl.getVariant('checkout-redesign', ['control', 'variant-a', 'variant-b']);

// Force-set (e.g., from server config)
Owl.setExperiment('checkout-redesign', 'variant-a');

// Clear all
Owl.clearExperiments();
```

All events automatically include an `experiments` field with current assignments.

## Serverless Support

Wrap handlers to guarantee event flush before returning:

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

```typescript
process.on('SIGTERM', async () => {
  await Owl.shutdown();
  process.exit(0);
});
```

- `shutdown()` stops the flush timer, flushes remaining events, and clears state.
- The `beforeExit` handler auto-flushes on graceful process exit even without explicit shutdown.

## Integration Patterns

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
