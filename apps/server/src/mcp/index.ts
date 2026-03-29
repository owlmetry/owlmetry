import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { API_KEY_PREFIX } from "@owlmetry/shared";
import { createMcpServer } from "./server.js";

export async function mcpRoute(app: FastifyInstance) {
  const bearerPrefix = `Bearer ${API_KEY_PREFIX.agent}`;

  app.post("/mcp", async (request, reply) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith(bearerPrefix)) {
      return reply.code(401).send({ error: "MCP endpoint requires an agent API key (owl_agent_*)" });
    }
    const agentKey = header.slice(7); // strip "Bearer "

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcp = createMcpServer(app, agentKey);
    await mcp.connect(transport);

    try {
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } finally {
      await mcp.close();
    }
  });

  app.get("/mcp", async (_, reply) => {
    reply.code(405).send({ error: "Method not allowed. Use POST for MCP requests." });
  });
  app.delete("/mcp", async (_, reply) => {
    reply.code(405).send({ error: "Method not allowed. Use POST for MCP requests." });
  });
}
