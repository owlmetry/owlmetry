import { createServer } from "node:http";
import { Owl } from "../../sdks/node/dist/src/index.js";

const PORT = 4007;
const API_KEY = "owl_client_svr_0000000000000000000000000000000000000000";

Owl.configure({
  endpoint: "http://localhost:4000",
  apiKey: API_KEY,
  serviceName: "demo-api",
  debug: true,
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(res, status, body) {
  res.writeHead(status, { ...corsHeaders(), "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const handleGreet = Owl.wrapHandler(async (req, res) => {
  const body = await parseBody(req);
  const { name = "World", userId } = body;

  const owl = userId ? Owl.withUser(userId) : Owl;
  const op = owl.startOperation("greet", { name });

  const message = `Hello, ${name}!`;
  op.complete({ name });

  json(res, 200, { message });
});

const handleCheckout = Owl.wrapHandler(async (req, res) => {
  const body = await parseBody(req);
  const { item = "unknown", userId } = body;

  const owl = userId ? Owl.withUser(userId) : Owl;
  const op = owl.startOperation("checkout", { item });
  owl.warn("Payment gateway timeout", { item });
  op.fail("payment_provider_unreachable", { item });

  json(res, 500, { error: "Payment provider unreachable" });
});

const server = createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health" && req.method === "GET") {
    json(res, 200, { status: "ok" });
    return;
  }

  if (url.pathname === "/api/greet" && req.method === "POST") {
    await handleGreet(req, res);
    return;
  }

  if (url.pathname === "/api/checkout" && req.method === "POST") {
    await handleCheckout(req, res);
    return;
  }

  json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Demo API server listening on http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  GET  /health");
  console.log("  POST /api/greet     { name, userId? }");
  console.log("  POST /api/checkout  { item, userId? }");
});

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await Owl.shutdown();
  server.close();
  process.exit(0);
});
