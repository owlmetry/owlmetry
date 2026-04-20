import { createHmac, timingSafeEqual } from "node:crypto";

function signAttachmentToken(
  attachmentId: string,
  expiresUnix: number,
  secret: string
): string {
  const payload = `${attachmentId}:${expiresUnix}`;
  const mac = createHmac("sha256", secret).update(payload).digest("hex");
  return `${attachmentId}.${expiresUnix}.${mac}`;
}

export interface VerifiedAttachmentToken {
  attachmentId: string;
  expiresUnix: number;
}

export function verifyAttachmentToken(
  token: string,
  secret: string
): VerifiedAttachmentToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [attachmentId, expiresStr, providedMac] = parts;
  const expiresUnix = Number(expiresStr);
  if (!attachmentId || !Number.isFinite(expiresUnix) || !providedMac) return null;
  if (expiresUnix < Math.floor(Date.now() / 1000)) return null;

  const expected = createHmac("sha256", secret)
    .update(`${attachmentId}:${expiresUnix}`)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(providedMac, "hex");
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  return { attachmentId, expiresUnix };
}

export function buildSignedDownloadUrl(
  publicUrl: string,
  attachmentId: string,
  ttlSeconds: number,
  secret: string
): { url: string; expiresUnix: number } {
  const expiresUnix = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = signAttachmentToken(attachmentId, expiresUnix, secret);
  const base = publicUrl.replace(/\/$/, "");
  return {
    url: `${base}/v1/attachments/download?t=${encodeURIComponent(token)}`,
    expiresUnix,
  };
}
