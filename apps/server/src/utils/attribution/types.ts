import type { AttributionDevMock } from "@owlmetry/shared";

/**
 * Outcome returned by a network-specific attribution resolver. The route
 * translates this into the HTTP response and decides whether to write user
 * properties.
 */
export type AttributionResolveOutcome =
  | {
      status: "resolved";
      /** `true` → network attributed the install; `false` → responded "not attributed". */
      attributed: boolean;
      /** Properties to merge into `app_users.properties`. Always includes `attribution_source`. */
      properties: Record<string, string>;
    }
  | {
      status: "pending";
      /** Suggested retry delay from the network (best-effort). */
      retryAfterSeconds: number;
    }
  | {
      status: "invalid";
      reason: string;
    }
  | {
      status: "upstream_error";
      upstreamStatus: number;
      message: string;
    };

/**
 * One resolver per attribution network. A resolver owns fetching (or
 * short-circuiting via dev_mock) and mapping the network-specific payload
 * into user properties.
 */
export interface AttributionResolver<Token = string> {
  /** Human-readable name for logs. */
  readonly name: string;
  /** Property prefix owned by this network (e.g. `asa_`). */
  readonly propertyPrefix: string;
  resolve(
    token: Token,
    opts: { devMock?: AttributionDevMock | null },
  ): Promise<AttributionResolveOutcome>;
}
