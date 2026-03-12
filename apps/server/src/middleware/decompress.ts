import { gunzip } from "node:zlib";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

const gunzipAsync = promisify(gunzip);

export const decompressPlugin = fp(async function (app: FastifyInstance) {
  app.addHook(
    "preParsing",
    async (request: FastifyRequest, _reply: FastifyReply, payload) => {
      if (request.headers["content-encoding"] !== "gzip") {
        return payload;
      }

      // Collect the compressed payload into a buffer
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const compressed = Buffer.concat(chunks);

      // Decompress
      const decompressed = await gunzipAsync(compressed);

      // Update headers so the JSON parser sees correct length
      delete request.headers["content-encoding"];
      request.headers["content-length"] = String(decompressed.length);

      return Readable.from(decompressed);
    }
  );
});
