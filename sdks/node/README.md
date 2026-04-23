# @owlmetry/node

Node.js SDK for [OwlMetry](https://owlmetry.com) — self-hosted metrics tracking for mobile and backend apps.

Zero runtime dependencies. Works with any Node.js framework.

## Install

```bash
npm install @owlmetry/node
```

## Quick Start

ESM:

```js
import { Owl } from "@owlmetry/node";
```

CommonJS:

```js
const { Owl } = require("@owlmetry/node");
```

```js
Owl.configure({
  clientKey: "owl_client_...",
  endpoint: "https://ingest.owlmetry.com",
});

// Log events
Owl.info("User signed up", { screen: "onboarding" });
Owl.error("Payment failed", { orderId: "abc123" });

// Track metrics
const op = Owl.startOperation("api-request");
// ... do work ...
op.complete({ route: "/users" });

// Record funnel steps
Owl.step("signup-started");

// Serverless support
export default Owl.wrapHandler(async (req, res) => {
  Owl.info("Request received");
  res.json({ ok: true });
});
```

## Links

- [Website](https://owlmetry.com)
- [GitHub](https://github.com/owlmetry/owlmetry)
- [CLI with AI skills](https://www.npmjs.com/package/@owlmetry/cli) — install the CLI and run `owlmetry skills` to get AI agent skill files
