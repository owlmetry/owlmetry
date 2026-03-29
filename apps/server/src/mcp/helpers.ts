import type { FastifyInstance, InjectOptions } from "fastify";

export interface CallToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface InjectResult {
  statusCode: number;
  body: Record<string, unknown>;
}

type ApiOpts = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  payload?: Record<string, unknown> | Array<unknown>;
};

async function inject(app: FastifyInstance, agentKey: string, opts: ApiOpts): Promise<InjectResult> {
  const injectOpts: InjectOptions = {
    method: opts.method,
    url: opts.url,
    headers: { authorization: `Bearer ${agentKey}` },
  };
  if (opts.payload !== undefined) {
    injectOpts.payload = opts.payload;
  }
  const res = await app.inject(injectOpts);
  return { statusCode: res.statusCode, body: res.json() };
}

function toToolResult(result: InjectResult): CallToolResult {
  if (result.statusCode >= 400) {
    return { content: [{ type: "text", text: JSON.stringify(result.body) }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(result.body, null, 2) }] };
}

/** Call an internal API route and return an MCP CallToolResult. */
export async function callApi(
  app: FastifyInstance,
  agentKey: string,
  opts: ApiOpts,
): Promise<CallToolResult> {
  return toToolResult(await inject(app, agentKey, opts));
}

/** Call an internal API route and return the parsed JSON body directly. Returns null on error. */
export async function callApiRaw(
  app: FastifyInstance,
  agentKey: string,
  opts: ApiOpts,
): Promise<{ body: Record<string, unknown>; error?: CallToolResult }> {
  const result = await inject(app, agentKey, opts);
  if (result.statusCode >= 400) {
    return { body: result.body, error: toToolResult(result) };
  }
  return { body: result.body };
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
  );
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}
