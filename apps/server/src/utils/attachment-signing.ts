import { createHmac, timingSafeEqual } from "node:crypto";

// Signed download URLs let the dashboard and CLI fetch attachment bytes without a
// session cookie on every request. The token is short-lived (seconds, not minutes)
// so it isn't worth caching or leaking. Format: <attachment_id>.<expires_unix>.<hmac>
// where hmac = HMAC-SHA256(secret, `${attachment_id}:${expires_unix}`).

export function signAttachmentToken(
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
  // Token goes in a query parameter so dots in the signature don't interact with URL
  // routing / path parsing in any downstream middleware.
  return {
    url: `${base}/v1/attachments/download?t=${encodeURIComponent(token)}`,
    expiresUnix,
  };
}
