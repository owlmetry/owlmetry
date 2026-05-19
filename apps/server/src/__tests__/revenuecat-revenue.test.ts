import { describe, it, expect } from "vitest";
import {
  sumLifetimeRevenueUsd,
  sumLifetimeRevenueUsdFromNonSubs,
  type RevenueCatV2SubscriptionsResponse,
  type RevenueCatV2NonSubscriptionsResponse,
} from "../utils/revenuecat.js";

function subs(...items: Array<Partial<RevenueCatV2SubscriptionsResponse["items"][number]>>): RevenueCatV2SubscriptionsResponse {
  return {
    object: "list",
    items: items as RevenueCatV2SubscriptionsResponse["items"],
    next_page: null,
    url: "",
  };
}

function nonSubs(...items: Array<Partial<RevenueCatV2NonSubscriptionsResponse["items"][number]>>): RevenueCatV2NonSubscriptionsResponse {
  return {
    object: "list",
    items: items as RevenueCatV2NonSubscriptionsResponse["items"],
    next_page: null,
    url: "",
  };
}

describe("sumLifetimeRevenueUsd", () => {
  it("returns null when the response is undefined", () => {
    expect(sumLifetimeRevenueUsd(undefined)).toBeNull();
  });

  it("returns 0 for a customer with no subscriptions", () => {
    expect(sumLifetimeRevenueUsd(subs())).toBe(0);
  });

  it("sums the gross leg of RC's revenue breakdown across subscriptions", () => {
    const result = sumLifetimeRevenueUsd(
      subs(
        { total_revenue_in_usd: { gross: 69.93, proceeds: 59.44, commission: 10.49, tax: 0, currency: "USD" } },
        { total_revenue_in_usd: { gross: 9.99, proceeds: 8.49, commission: 1.5, tax: 0, currency: "USD" } },
      ),
    );
    expect(result).toBeCloseTo(79.92, 2);
  });

  it("treats subscriptions without total_revenue_in_usd as 0", () => {
    expect(sumLifetimeRevenueUsd(subs({}, { total_revenue_in_usd: { gross: 9.99 } }))).toBeCloseTo(9.99, 2);
  });

  it("treats subscriptions whose gross is missing or non-finite as 0", () => {
    expect(
      sumLifetimeRevenueUsd(
        subs(
          { total_revenue_in_usd: { proceeds: 5 } },
          { total_revenue_in_usd: { gross: Number.NaN } },
          { total_revenue_in_usd: { gross: 4.99 } },
        ),
      ),
    ).toBeCloseTo(4.99, 2);
  });
});

describe("sumLifetimeRevenueUsdFromNonSubs", () => {
  it("returns null when the response is undefined", () => {
    expect(sumLifetimeRevenueUsdFromNonSubs(undefined)).toBeNull();
  });

  it("returns 0 for a customer with no non-subscription purchases", () => {
    expect(sumLifetimeRevenueUsdFromNonSubs(nonSubs())).toBe(0);
  });

  it("sums the `revenue_in_usd.gross` field (not `total_revenue_in_usd`)", () => {
    // RC's purchases endpoint uses `revenue_in_usd`, NOT `total_revenue_in_usd`
    // as on subscriptions. Confirmed against a live response on 2026-05-19.
    // This test locks in the field name so a refactor can't quietly regress
    // the 3DKit "Pro Lifetime $5.27" scenario back to $0.
    const result = sumLifetimeRevenueUsdFromNonSubs(
      nonSubs(
        { revenue_in_usd: { gross: 5.27, proceeds: 3.8, commission: 0.67, tax: 0.8, currency: "USD" } },
        { revenue_in_usd: { gross: 2.5 } },
      ),
    );
    expect(result).toBeCloseTo(7.77, 2);
  });

  it("treats purchases without revenue_in_usd as 0", () => {
    expect(sumLifetimeRevenueUsdFromNonSubs(nonSubs({}, { revenue_in_usd: { gross: 4.99 } }))).toBeCloseTo(4.99, 2);
  });
});
