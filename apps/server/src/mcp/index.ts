import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { API_KEY_PREFIX } from "@owlmetry/shared";
import { createMcpServer } from "./server.js";

export async function mcpRoute(app: FastifyInstance) {
  const bearerPrefix = `Bearer ${API_KEY_PREFIX.agent}`;

  /** Extract agent key from Bearer header, or null if missing/invalid. */
  function extractKey(request: {
    headers: { authorization?: string };
  }): string | null {
    const header = request.headers.authorization;
    if (!header || !header.startsWith(bearerPrefix)) return null;
    return header.slice(7); // strip "Bearer "
  }

  // POST — stateless JSON request/response (one transport per request)
  app.post("/mcp", async (request, reply) => {
    const agentKey = extractKey(request);
    if (!agentKey) {
      // Plain 401 without WWW-Authenticate to avoid triggering OAuth flows
      return reply
        .code(401)
        .send({
          error: "MCP endpoint requires an agent API key (owl_agent_*)",
        });
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcp = createMcpServer(app, agentKey);
    await mcp.connect(transport);

    reply.hijack();
    const res = reply.raw;
    res.on("close", () => {
      transport.close();
      mcp.close();
    });
    await transport.handleRequest(request.raw, res, request.body);
  });

  // GET — SSE stream if authenticated, otherwise 405 to avoid triggering OAuth
  app.get("/mcp", async (request, reply) => {
    const agentKey = extractKey(request);
    if (!agentKey) {
      return reply
        .code(405)
        .send({ error: "Method not allowed." });
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const mcp = createMcpServer(app, agentKey);
    await mcp.connect(transport);

    reply.hijack();
    const res = reply.raw;

    // Send keepalive comments to prevent Cloudflare/nginx idle timeout
    const keepalive = setInterval(() => {
      if (!res.destroyed) {
        res.write(": keepalive\n\n");
      }
    }, 30_000);

    res.on("close", () => {
      clearInterval(keepalive);
      transport.close();
      mcp.close();
    });

    await transport.handleRequest(request.raw, res, request.body);
  });

  // DELETE — 405 in stateless mode
  app.delete("/mcp", async (_, reply) => {
    reply.code(405).send({ error: "Method not allowed." });
  });
}
