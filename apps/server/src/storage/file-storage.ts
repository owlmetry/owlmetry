import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  promises as fs,
} from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { Readable } from "node:stream";

export interface FileStorage {
  put(args: {
    projectId: string;
    objectKey: string;
    source: Readable;
    expectedSizeBytes: number;
  }): Promise<{ storagePath: string; sizeBytes: number; sha256: string }>;

  get(storagePath: string): Promise<{ stream: Readable; sizeBytes: number }>;

  toInternalUri(storagePath: string): string | null;

  delete(storagePath: string): Promise<void>;

  listOrphans(knownPaths: Set<string>): AsyncGenerator<string>;
}

export class DiskFileStorage implements FileStorage {
  constructor(
    private readonly baseDir: string,
    private readonly internalUri: string = ""
  ) {}

  private pathFor(projectId: string, objectKey: string): string {
    const now = new Date();
    const shard = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const resolvedBase = resolve(this.baseDir);
    const resolvedFile = resolve(resolvedBase, projectId, shard, objectKey);
    if (!resolvedFile.startsWith(resolvedBase + sep) && resolvedFile !== resolvedBase) {
      throw new Error("resolved path escapes storage base");
    }
    return resolvedFile;
  }

  async put({
    projectId,
    objectKey,
    source,
    expectedSizeBytes,
  }: {
    projectId: string;
    objectKey: string;
    source: Readable;
    expectedSizeBytes: number;
  }): Promise<{ storagePath: string; sizeBytes: number; sha256: string }> {
    const storagePath = this.pathFor(projectId, objectKey);
    await fs.mkdir(dirname(storagePath), { recursive: true });

    const hash = createHash("sha256");
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        sizeBytes += chunk.length;
        if (sizeBytes > expectedSizeBytes) {
          cb(new Error("declared_size_exceeded"));
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    const writeStream = createWriteStream(storagePath);

    try {
      await pipeline(source, meter, writeStream);
    } catch (err) {
      await this.delete(storagePath).catch(() => {});
      throw err;
    }

    return { storagePath, sizeBytes, sha256: hash.digest("hex") };
  }

  async get(storagePath: string): Promise<{ stream: Readable; sizeBytes: number }> {
    const stat = await fs.stat(storagePath);
    return { stream: createReadStream(storagePath), sizeBytes: stat.size };
  }

  toInternalUri(storagePath: string): string | null {
    if (!this.internalUri) return null;
    const resolvedBase = resolve(this.baseDir);
    const resolvedFile = resolve(storagePath);
    if (!resolvedFile.startsWith(resolvedBase + sep)) return null;
    const relative = resolvedFile.slice(resolvedBase.length + 1).split(sep).join("/");
    const prefix = this.internalUri.endsWith("/") ? this.internalUri : this.internalUri + "/";
    return prefix + relative;
  }

  async delete(storagePath: string): Promise<void> {
    try {
      await fs.unlink(storagePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw err;
    }
    const parent = dirname(storagePath);
    try {
      const entries = await fs.readdir(parent);
      if (entries.length === 0) await fs.rmdir(parent);
    } catch {
      // best-effort empty-dir cleanup; non-fatal
    }
  }

  async *listOrphans(knownPaths: Set<string>): AsyncGenerator<string> {
    const base = normalize(this.baseDir);
    if (!existsSync(base)) return;
    async function* walk(dir: string): AsyncGenerator<string> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          yield* walk(full);
        } else if (entry.isFile()) {
          yield full;
        }
      }
    }
    for await (const file of walk(base)) {
      if (!knownPaths.has(file) && !knownPaths.has(resolve(file))) {
        yield file;
      }
    }
  }
}
