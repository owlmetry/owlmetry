import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ValidatedConfig } from "./configuration.js";

export interface OwlAttachment {
  /** Absolute path to a file on disk. Mutually exclusive with `buffer`. */
  path?: string;
  /** In-memory bytes. Mutually exclusive with `path`. */
  buffer?: Buffer | Uint8Array;
  /** Filename shown on the server. Required for `buffer`; defaults to basename of `path`. */
  name?: string;
  /** Overrides the inferred/default content type. */
  contentType?: string;
}

interface PendingUpload {
  clientEventId: string;
  isDev: boolean;
  attachment: OwlAttachment;
}

interface ReserveResponse {
  attachment_id: string;
  upload_url: string;
}

const DEFAULT_MAX_FILE_BYTES = 250 * 1024 * 1024;
const EXT_CONTENT_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".txt": "text/plain",
  ".json": "application/json",
  ".log": "text/plain",
  ".zip": "application/zip",
  ".pdf": "application/pdf",
  ".usdz": "model/vnd.usdz+zip",
  ".obj": "model/obj",
};

function inferContentType(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return EXT_CONTENT_TYPE[name.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class AttachmentUploader {
  private pending: PendingUpload[] = [];
  private draining = false;
  private maxFileBytes = DEFAULT_MAX_FILE_BYTES;

  constructor(private readonly cfg: ValidatedConfig) {}

  enqueue(clientEventId: string, isDev: boolean, attachments: OwlAttachment[]): void {
    for (const attachment of attachments) {
      this.pending.push({ clientEventId, isDev, attachment });
    }
    if (!this.draining) {
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const next = this.pending.shift()!;
        try {
          await this.uploadOne(next);
        } catch (err) {
          if (this.cfg.debug) {
            console.error("OwlMetry: attachment upload failed", err);
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async uploadOne(item: PendingUpload): Promise<void> {
    let bytes: Uint8Array;
    let name: string;
    let contentType: string;

    if (item.attachment.buffer !== undefined) {
      bytes =
        item.attachment.buffer instanceof Uint8Array
          ? item.attachment.buffer
          : new Uint8Array(item.attachment.buffer as ArrayBufferLike);
      name = item.attachment.name ?? "attachment.bin";
      contentType = item.attachment.contentType ?? inferContentType(name);
    } else if (item.attachment.path) {
      bytes = await readFile(item.attachment.path);
      const slash = item.attachment.path.lastIndexOf("/");
      const inferredName = slash === -1 ? item.attachment.path : item.attachment.path.slice(slash + 1);
      name = item.attachment.name ?? inferredName;
      contentType = item.attachment.contentType ?? inferContentType(name);
    } else {
      if (this.cfg.debug) console.error("OwlMetry: attachment missing both path and buffer");
      return;
    }

    if (bytes.length === 0) {
      if (this.cfg.debug) console.error(`OwlMetry: skipping empty attachment "${name}"`);
      return;
    }
    if (bytes.length > this.maxFileBytes) {
      if (this.cfg.debug) {
        console.error(
          `OwlMetry: attachment "${name}" is ${bytes.length} bytes, exceeds SDK limit ${this.maxFileBytes}. Skipping.`
        );
      }
      return;
    }

    const sha = sha256Hex(bytes);
    const reserve = await this.reserve({
      clientEventId: item.clientEventId,
      name,
      contentType,
      sizeBytes: bytes.length,
      sha256: sha,
      isDev: item.isDev,
    });
    if (!reserve) return;

    await this.putBytes(reserve.upload_url, bytes, name);
  }

  private async reserve(args: {
    clientEventId: string;
    name: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    isDev: boolean;
  }): Promise<ReserveResponse | null> {
    const url = new URL(this.cfg.endpoint);
    const base = url.href.replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/v1/ingest/attachment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          client_event_id: args.clientEventId,
          original_filename: args.name,
          content_type: args.contentType,
          size_bytes: args.sizeBytes,
          sha256: args.sha256,
          is_dev: args.isDev,
        }),
      });
      if (!res.ok) {
        if (this.cfg.debug) {
          const body = await res.text().catch(() => "");
          console.error(`OwlMetry: attachment reserve for "${args.name}" rejected (${res.status}): ${body}`);
        }
        return null;
      }
      return (await res.json()) as ReserveResponse;
    } catch (err) {
      if (this.cfg.debug) console.error("OwlMetry: attachment reserve network error", err);
      return null;
    }
  }

  private async putBytes(url: string, bytes: Uint8Array, name: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            Authorization: `Bearer ${this.cfg.apiKey}`,
          },
          body: bytes as unknown as BodyInit,
        });
        if (res.ok) return;
        if (res.status >= 400 && res.status < 500) {
          if (this.cfg.debug) {
            const body = await res.text().catch(() => "");
            console.error(`OwlMetry: attachment upload "${name}" rejected (${res.status}): ${body}`);
          }
          return;
        }
        if (this.cfg.debug) {
          console.error(`OwlMetry: attachment upload "${name}" returned ${res.status}, attempt ${attempt + 1}`);
        }
      } catch (err) {
        if (this.cfg.debug) console.error("OwlMetry: attachment upload network error", err);
      }
    }
  }
}
