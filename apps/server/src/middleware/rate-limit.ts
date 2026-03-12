import type { FastifyRequest, FastifyReply } from "fastify";

interface TokenBucket {
  tokens: number;
  last_refill: number;
}

const buckets = new Map<string, TokenBucket>();

const MAX_TOKENS = 100;
const REFILL_RATE = 10; // tokens per second
const REFILL_INTERVAL_MS = 1000;

function getRateLimitBucketKey(request: FastifyRequest): string {
  if (request.auth) {
    return request.auth.type === "api_key"
      ? `key:${request.auth.key_id}`
      : `user:${request.auth.user_id}`;
  }
  return `ip:${request.ip}`;
}

export async function rateLimit(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const key = getRateLimitBucketKey(request);
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: MAX_TOKENS, last_refill: now };
    buckets.set(key, bucket);
  }

  // Refill tokens
  const elapsed = now - bucket.last_refill;
  const refill = Math.floor(elapsed / REFILL_INTERVAL_MS) * REFILL_RATE;
  if (refill > 0) {
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + refill);
    bucket.last_refill = now;
  }

  if (bucket.tokens <= 0) {
    reply.header("Retry-After", "1");
    return reply.code(429).send({ error: "Rate limit exceeded" });
  }

  bucket.tokens--;
}

// Cleanup old buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, bucket] of buckets) {
    if (bucket.last_refill < cutoff) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();
