import type { ChannelAdapter, ChannelDeliveryResult } from "../types.js";

/**
 * No-op: the inbox row insert IS the in-app delivery. The dispatcher writes
 * the in_app delivery row as `sent` synchronously — this adapter only exists
 * so calling code can iterate over channels uniformly.
 */
export const inAppAdapter: ChannelAdapter = {
  channel: "in_app",
  async deliver(): Promise<ChannelDeliveryResult> {
    return { status: "sent" };
  },
};
