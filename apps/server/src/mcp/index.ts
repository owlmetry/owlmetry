import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

export async function mcpRoute(app: FastifyInstance) {
  app.post("/mcp", async (request, reply) => {
    // Extract agent key from Authorization header
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer owl_agent_")) {
      return reply.code(401).send({ error: "MCP endpoint requires an agent API key (owl_agent_*)" });
    }
    const agentKey = header.slice(7); // strip "Bearer "

    // Create stateless MCP server per request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking
      enableJsonResponse: true, // JSON responses, no SSE
    });
    const mcp = createMcpServer(app, agentKey);
    await mcp.connect(transport);

    // Hand off to the MCP SDK's request handler
    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  // GET and DELETE are not supported in stateless mode
  app.get("/mcp", async (_, reply) => {
    reply.code(405).send({ error: "Method not allowed. Use POST for MCP requests." });
  });
  app.delete("/mcp", async (_, reply) => {
    reply.code(405).send({ error: "Method not allowed. Use POST for MCP requests." });
  });
}
