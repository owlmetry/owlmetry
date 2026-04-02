import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { API_KEY_PREFIX } from "@owlmetry/shared";
import { createMcpServer } from "./server.js";
import { config } from "../config.js";

export async function mcpRoute(app: FastifyInstance) {
  const bearerPrefix = `Bearer ${API_KEY_PREFIX.agent}`;
  const resourceUrl = `${config.publicUrl}/mcp`;
  const resourceMetadataUrl = `${config.publicUrl}/.well-known/oauth-protected-resource`;

  // ── RFC 9728 Protected Resource Metadata ────────────────────────────
  // Tells MCP clients that this server accepts Bearer tokens in headers.
  // Serves at both the root and /mcp path-aware locations per the spec.
  const resourceMetadata = {
    resource: resourceUrl,
    bearer_methods_supported: ["header"],
    resource_documentation: "https://owlmetry.com/docs/mcp",
  };

  app.get("/.well-known/oauth-protected-resource", async (_request, reply) => {
    return reply.send(resourceMetadata);
  });
  app.get(
    "/.well-known/oauth-protected-resource/mcp",
    async (_request, reply) => {
      return reply.send(resourceMetadata);
    },
  );

  /** Extract agent key from Bearer header, or send 401 and return null. */
  function extractKey(
    request: { headers: { authorization?: string } },
    reply: {
      code: (n: number) => { header: (k: string, v: string) => { send: (body: unknown) => void } };
    },
  ): string | null {
    const header = request.headers.authorization;
    if (!header || !header.startsWith(bearerPrefix)) {
      reply
        .code(401)
        .header(
          "WWW-Authenticate",
          `Bearer resource_metadata="${resourceMetadataUrl}"`,
        )
        .send({
          error: "MCP endpoint requires an agent API key (owl_agent_*)",
        });
      return null;
    }
    return header.slice(7); // strip "Bearer "
  }

  /** Validate key against the database via internal /v1/auth/whoami call. */
  async function validateKey(agentKey: string): Promise<boolean> {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/whoami",
      headers: { authorization: `Bearer ${agentKey}` },
    });
    return res.statusCode === 200;
  }

  // POST — stateless JSON request/response (one transport per request)
  app.post("/mcp", async (request, reply) => {
    const agentKey = extractKey(request, reply);
    if (!agentKey) return;

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

  // GET — long-lived SSE stream for server health / notifications
  app.get("/mcp", async (request, reply) => {
    const agentKey = extractKey(request, reply);
    if (!agentKey) return;

    // Validate key before opening a long-lived connection
    if (!(await validateKey(agentKey))) {
      return reply.code(401).send({ error: "Invalid API key" });
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

  // DELETE — stateless, no session to close
  app.delete("/mcp", async (request, reply) => {
    const agentKey = extractKey(request, reply);
    if (!agentKey) return;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
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
}
