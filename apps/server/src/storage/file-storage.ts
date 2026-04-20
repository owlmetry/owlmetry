import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  promises as fs,
} from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

// FileStorage abstracts where attachment bytes live. The server reads/writes through
// this interface so a future S3/R2 adapter is a drop-in replacement without touching
// route code. The v1 implementation stores files on the local filesystem.
export interface FileStorage {
  // Persist the contents of `source` for the given project at the given object key.
  // Computes SHA-256 and byte count as it streams. Returns the on-disk path and hash.
  // If `expectedSizeBytes` is provided and the stream exceeds it, the partial file is
  // deleted and an error is thrown — so quota-exhausted uploads never linger on disk.
  put(args: {
    projectId: string;
    objectKey: string;
    source: Readable;
    expectedSizeBytes: number;
  }): Promise<{ storagePath: string; sizeBytes: number; sha256: string }>;

  // Return a readable stream for the given path plus its size.
  get(storagePath: string): Promise<{ stream: Readable; sizeBytes: number }>;

  // For nginx X-Accel-Redirect: resolve an internal URI for the given storage path,
  // given the configured internalUri prefix and base attachments directory.
  toInternalUri(storagePath: string, internalUri: string, baseDir: string): string;

  // Delete a file. Missing files are not an error (idempotent).
  delete(storagePath: string): Promise<void>;

  // Walk the storage root for files whose paths are not in `knownPaths`. Used by the
  // attachment_cleanup job to sweep disk-only orphans.
  listOrphans(knownPaths: Set<string>): AsyncGenerator<string>;
}

export class DiskFileStorage implements FileStorage {
  constructor(private readonly baseDir: string) {}

  private pathFor(projectId: string, objectKey: string): string {
    const yyyy = new Date().getUTCFullYear();
    const mm = String(new Date().getUTCMonth() + 1).padStart(2, "0");
    const shard = `${yyyy}-${mm}`;
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
    const writeStream = createWriteStream(storagePath);

    const abortIfOverflow = new Promise<never>((_, reject) => {
      source.on("data", (chunk: Buffer) => {
        sizeBytes += chunk.length;
        hash.update(chunk);
        if (sizeBytes > expectedSizeBytes) {
          source.destroy(new Error("declared_size_exceeded"));
          reject(new Error("declared_size_exceeded"));
        }
      });
    });

    try {
      await Promise.race([pipeline(source, writeStream), abortIfOverflow]);
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

  toInternalUri(storagePath: string, internalUri: string, baseDir: string): string {
    const resolvedBase = resolve(baseDir);
    const resolvedFile = resolve(storagePath);
    if (!resolvedFile.startsWith(resolvedBase + sep)) {
      throw new Error("storage path is not under base dir");
    }
    const relative = resolvedFile.slice(resolvedBase.length + 1).split(sep).join("/");
    const prefix = internalUri.endsWith("/") ? internalUri : internalUri + "/";
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
