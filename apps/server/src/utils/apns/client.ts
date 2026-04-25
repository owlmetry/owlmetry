import { connect as http2Connect, type ClientHttp2Session } from "node:http2";
import type { ApnsConfig } from "./config.js";
import { getCachedApnsJwt } from "./jwt.js";

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Outcome of a single APNs push attempt. `unregistered` and `bad_token` are
 * distinguished from `error` so callers know to revoke the device token row
 * (Apple has reissued / the device is gone).
 */
export type ApnsResult =
  | { status: "delivered"; apnsId: string | null }
  | { status: "unregistered" }   // 410 — token reassigned by Apple
  | { status: "bad_token" }      // 400 BadDeviceToken
  | { status: "error"; statusCode: number; reason: string };

export interface ApnsPushPayload {
  alert: { title: string; body: string };
  /** Deep link path. Same string used by web links and iOS DeepLinkRouter. */
  link?: string;
  /** Notification type tag — used by iOS to disambiguate routing. */
  type?: string;
  /** Notification id — the inbox row id; iOS can use it to mark read. */
  notificationId?: string;
  /** App icon badge count. Server computes from unread count just before push. */
  badge?: number;
  /** Extra data passed through verbatim in the payload root. */
  extra?: Record<string, unknown>;
}

export class ApnsClient {
  private session: ClientHttp2Session | null = null;

  constructor(private config: ApnsConfig, private host: string) {}

  /**
   * Send a push to one device token. Resolves with the outcome — never throws.
   * Re-uses a single HTTP/2 session; reconnects on goaway / closed sessions.
   */
  async push(deviceToken: string, payload: ApnsPushPayload): Promise<ApnsResult> {
    const session = this.ensureSession();

    const body = JSON.stringify({
      aps: {
        alert: payload.alert,
        sound: "default",
        ...(payload.badge !== undefined ? { badge: payload.badge } : {}),
      },
      ...(payload.link ? { link: payload.link } : {}),
      ...(payload.type ? { type: payload.type } : {}),
      ...(payload.notificationId ? { notification_id: payload.notificationId } : {}),
      ...(payload.extra ?? {}),
    });

    const headers = {
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "authorization": `bearer ${getCachedApnsJwt(this.config)}`,
      "apns-topic": this.config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    };

    return new Promise<ApnsResult>((resolve) => {
      const req = session.request(headers);
      let responseStatus = 0;
      let apnsId: string | null = null;
      const chunks: Buffer[] = [];

      const timeout = setTimeout(() => {
        req.close();
        resolve({ status: "error", statusCode: 0, reason: "timeout" });
      }, REQUEST_TIMEOUT_MS);

      req.on("response", (h) => {
        responseStatus = Number(h[":status"] ?? 0);
        const id = h["apns-id"];
        apnsId = typeof id === "string" ? id : null;
      });
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        clearTimeout(timeout);
        const responseBody = Buffer.concat(chunks).toString("utf8");
        if (responseStatus === 200) {
          resolve({ status: "delivered", apnsId });
          return;
        }
        const reason = parseReason(responseBody);
        if (responseStatus === 410 || reason === "Unregistered") {
          resolve({ status: "unregistered" });
          return;
        }
        if (responseStatus === 400 && reason === "BadDeviceToken") {
          resolve({ status: "bad_token" });
          return;
        }
        resolve({ status: "error", statusCode: responseStatus, reason: reason ?? responseBody });
      });
      req.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ status: "error", statusCode: 0, reason: err.message });
      });

      req.end(body);
    });
  }

  close(): void {
    if (this.session && !this.session.closed) {
      this.session.close();
    }
    this.session = null;
  }

  private ensureSession(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) {
      return this.session;
    }
    const session = http2Connect(this.host);
    session.on("error", () => {
      // Surface via per-request error path; reset session for next call.
      this.session = null;
    });
    session.on("goaway", () => {
      this.session = null;
    });
    session.on("close", () => {
      this.session = null;
    });
    this.session = session;
    return session;
  }
}

function parseReason(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    return typeof parsed.reason === "string" ? parsed.reason : null;
  } catch {
    return null;
  }
}
