import { createGunzip } from "node:zlib";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

const MAX_COMPRESSED_SIZE = 1024 * 1024; // 1 MiB limit on compressed input

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

      return payload.pipe(createGunzip());
    }
  );
});
