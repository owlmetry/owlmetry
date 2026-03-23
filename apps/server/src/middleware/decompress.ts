import { createGunzip } from "node:zlib";
import { Transform, type TransformCallback, pipeline } from "node:stream";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

const MAX_COMPRESSED_SIZE = 1024 * 1024;   // 1 MiB limit on compressed input
const MAX_DECOMPRESSED_SIZE = 1024 * 1024; // 1 MiB limit on decompressed output

class SizeLimitedStream extends Transform {
  private bytesRead = 0;
  private readonly limit: number;

  constructor(limit: number) {
    super();
    this.limit = limit;
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.bytesRead += chunk.length;
    if (this.bytesRead > this.limit) {
      const error = new Error("Decompressed payload too large") as Error & { statusCode: number };
      error.statusCode = 413;
      this.destroy(error);
      return;
    }
    callback(null, chunk);
  }
}

export const decompressPlugin = fp(async function (app: FastifyInstance) {
  app.addHook(
    "preParsing",
    async (request: FastifyRequest, reply: FastifyReply, payload) => {
      if (request.headers["content-encoding"] !== "gzip") {
        return payload;
      }

      const contentLength = Number(request.headers["content-length"]);
      if (contentLength > MAX_COMPRESSED_SIZE) {
        reply.code(413).send({ error: "Compressed payload too large" });
        return;
      }

      delete request.headers["content-encoding"];
      delete request.headers["content-length"];

      const gunzip = createGunzip();
      const limiter = new SizeLimitedStream(MAX_DECOMPRESSED_SIZE);
      pipeline(payload, gunzip, limiter, () => {});

      return limiter;
    }
  );
});
