import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "fastify";

export interface CallToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export async function callApi(
  app: FastifyInstance,
  agentKey: string,
  opts: { method: "GET" | "POST" | "PATCH" | "DELETE"; url: string; payload?: Record<string, unknown> | Array<unknown> },
): Promise<CallToolResult> {
  const injectOpts: InjectOptions = {
    method: opts.method,
    url: opts.url,
    headers: { authorization: `Bearer ${agentKey}` },
  };
  if (opts.payload !== undefined) {
    injectOpts.payload = opts.payload;
  }

  const res = await app.inject(injectOpts);

  const body = res.json();
  if (res.statusCode >= 400) {
    return { content: [{ type: "text", text: JSON.stringify(body) }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
  );
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}
