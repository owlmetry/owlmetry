# @owlmetry/node

Node.js SDK for [OwlMetry](https://owlmetry.com) — self-hosted metrics tracking for mobile and backend apps.

Zero runtime dependencies. Works with any Node.js framework.

## Install

```bash
npm install @owlmetry/node
```

## Quick Start

```js
import OwlMetry from "@owlmetry/node";

OwlMetry.configure({
  clientKey: "owl_client_...",
  endpoint: "https://ingest.owlmetry.com",
});

// Log events
OwlMetry.info("User signed up", { screen: "onboarding" });
OwlMetry.error("Payment failed", { orderId: "abc123" });

// Track metrics
const op = OwlMetry.startOperation("api-request");
// ... do work ...
op.complete({ route: "/users" });

// Track funnels
OwlMetry.track("signup-started");

// Serverless support
export default OwlMetry.wrapHandler(async (req, res) => {
  OwlMetry.info("Request received");
  res.json({ ok: true });
});
```

## Links

- [Website](https://owlmetry.com)
- [GitHub](https://github.com/Jasonvdb/owlmetry)
- [CLI with AI skills](https://www.npmjs.com/package/@owlmetry/cli) — install the CLI and run `owlmetry skills` to get AI agent skill files
